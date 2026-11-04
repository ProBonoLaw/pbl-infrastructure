"""Copy evidence queues after writers stop, retaining every source message.

Receiving temporarily hides messages. Both source and destination visibility is
restored in finally. The destination is verified against the complete source
message multiset. Queue-generated IDs, insertion times, and dequeue counts are
not transferable; payloads and remaining expiry are preserved. Never deletes
messages or clears a queue. Keep the journal private; it contains message data.
"""
import argparse
import collections
import datetime
import hashlib
import json
import math
import sqlite3
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from azure.core.exceptions import ResourceExistsError
from azure.identity import DefaultAzureCredential
from azure.storage.queue import QueueServiceClient

PAIRS = {"integritycachetestsuffix": "probonolawdatatestsuffix",
         "integritycacheprodsuffix": "probonolawdataprodsuffix"}
NAMES = ("evidence-finalize", "evidence-gather", "evidence-poison",
         "evidence-reconcile", "evidence-repair", "evidence-review")


def content_hash(content):
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def missing_messages(source, destination):
    remaining = collections.Counter(content_hash(message.content) for message in destination)
    source_counts = collections.Counter(content_hash(message.content) for message in source)
    if remaining - source_counts:
        raise RuntimeError("Destination has messages outside this source snapshot")
    missing = []
    for message in source:
        key = content_hash(message.content)
        if remaining[key]:
            remaining[key] -= 1
        else:
            missing.append(message)
    return missing


def lifetime(message, now):
    if message.expires_on is None or message.expires_on.year >= 9999:
        return -1
    return max(1, math.ceil((message.expires_on - now).total_seconds()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-account", required=True, choices=PAIRS)
    parser.add_argument("--target-account", required=True)
    parser.add_argument("--journal", required=True)
    parser.add_argument("--writers-frozen", required=True, action="store_true")
    args = parser.parse_args()
    if PAIRS[args.source_account] != args.target_account:
        raise ValueError("Source and destination must belong to the same environment")
    credential = DefaultAzureCredential(exclude_interactive_browser_credential=True)
    services = {"source": QueueServiceClient(f"https://{args.source_account}.queue.core.windows.net", credential=credential),
                "target": QueueServiceClient(f"https://{args.target_account}.queue.core.windows.net", credential=credential)}
    journal = sqlite3.connect(args.journal, check_same_thread=False)
    # Append-only WAL avoids repeated rollback-journal creation during the
    # writer pause; FULL keeps receipt commits durable for visibility recovery.
    journal.execute("pragma journal_mode=WAL")
    journal.execute("pragma synchronous=FULL")
    journal.execute("create table if not exists settings (name text primary key, value text)")
    for key, value in {"source": args.source_account, "target": args.target_account}.items():
        previous = journal.execute("select value from settings where name=?", (key,)).fetchone()
        if previous and previous[0] != value:
            raise RuntimeError("Journal belongs to another storage migration")
        journal.execute("insert or ignore into settings values (?,?)", (key, value))
    journal.execute("create table if not exists queues (name text primary key, verified integer)")
    journal.execute("create table if not exists receipts (side text,name text,id text,receipt text,content text,primary key(side,name,id))")
    journal.commit()
    mutex = threading.Lock()

    def save(side, name, message):
        with mutex:
            journal.execute("insert or replace into receipts values (?,?,?,?,?)",
                            (side, name, message.id, message.pop_receipt, message.content))
            journal.commit()

    def reveal(row):
        side, name, identifier, receipt = row
        try:
            services[side].get_queue_client(name).update_message(identifier, pop_receipt=receipt, visibility_timeout=0)
        except Exception as error:
            # Receipt expiry or message expiry needs no further visibility reset.
            if getattr(error, 'error_code', None) not in {'MessageNotFound', 'PopReceiptMismatch'}:
                raise
        with mutex:
            journal.execute("delete from receipts where side=? and name=? and id=?", (side, name, identifier))
            journal.commit()

    def reveal_all():
        rows = journal.execute("select side,name,id,receipt from receipts").fetchall()
        with ThreadPoolExecutor(max_workers=16) as pool:
            list(pool.map(reveal, rows))

    def collect(side, name, expected):
        client = services[side].get_queue_client(name)
        collected = {}
        started = time.monotonic()
        while len(collected) < expected:
            batch_size = min(32, expected-len(collected))
            page = list(client.receive_messages(messages_per_page=batch_size,
                        max_messages=batch_size, visibility_timeout=900))
            for message in page:
                collected[message.id] = message
                save(side, name, message)
            if not page:
                if time.monotonic() - started > 600:
                    raise RuntimeError("Some source messages remain invisible; retry after their visibility timeout")
                time.sleep(2)
            if len(collected) and len(collected) % 1024 == 0:
                print(json.dumps({"queue": name, "side": side, "collected": len(collected), "expected": expected}), flush=True)
        return list(collected.values())

    reveal_all()  # Recover visibility if an earlier invocation stopped.
    try:
        for name in NAMES:
            source = services['source'].get_queue_client(name)
            target = services['target'].get_queue_client(name)
            source_properties = source.get_queue_properties()
            try:
                target.create_queue(metadata=source_properties.metadata)
            except ResourceExistsError:
                if target.get_queue_properties().metadata != source_properties.metadata:
                    raise RuntimeError("Destination queue metadata differs")
            target_count = target.get_queue_properties().approximate_message_count
            owned = journal.execute("select verified from queues where name=?", (name,)).fetchone()
            if target_count and owned is None:
                raise RuntimeError("Destination queue already has untracked messages")
            journal.execute("insert or ignore into queues values (?,0)", (name,))
            journal.commit()
            source_messages = collect('source', name, source_properties.approximate_message_count)
            target_messages = collect('target', name, target_count)
            missing = missing_messages(source_messages, target_messages)

            def send(message):
                result = target.send_message(message.content, visibility_timeout=900,
                    time_to_live=lifetime(message, datetime.datetime.now(datetime.timezone.utc)))
                result.content = message.content
                save('target', name, result)

            with ThreadPoolExecutor(max_workers=16) as pool:
                list(pool.map(send, missing))
            # Make all destination messages visible, then read every message back.
            target_receipts = journal.execute("select side,name,id,receipt from receipts where side='target' and name=?", (name,)).fetchall()
            with ThreadPoolExecutor(max_workers=16) as pool:
                list(pool.map(reveal, target_receipts))
            actual = collect('target', name, len(source_messages))
            if missing_messages(source_messages, actual) or len(actual) != len(source_messages):
                raise RuntimeError("Queue payload verification failed")
            journal.execute("update queues set verified=1 where name=?", (name,))
            journal.commit()
            reveal_all()
            if (source.get_queue_properties().approximate_message_count != len(source_messages)
                    or target.get_queue_properties().approximate_message_count != len(actual)):
                raise RuntimeError("Queue counts changed during migration; keep consumers on the source")
            print(json.dumps({"queue": name, "sourceMessages": len(source_messages),
                              "copied": len(missing), "verified": len(actual),
                              "sourceRetained": True, "visibilityRestored": True}), flush=True)
    finally:
        reveal_all()
        journal.close()
        credential.close()


if __name__ == '__main__':
    main()
