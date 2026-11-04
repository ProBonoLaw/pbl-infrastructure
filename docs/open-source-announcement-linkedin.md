# ProBono Law — open source announcement (LinkedIn)

Draft for publication. Copy the body below; the horizontal rules are not part of the post.

---

I built ProBono Law to give people a fighting chance in court when they couldn't afford a lawyer. I'm open sourcing it.

The honest version of why: I'm not a social person, and I couldn't raise the investment. I could have kept grinding, or tried to out-compete companies with deeper pockets and better networks. I'd rather the thing exist and get used than stay mine and die quietly.

The reason it exists at all is personal. I went through a custody fight as a father. I'm not putting my case on LinkedIn, but I'll say this much: I walked in feeling I had to disprove something about myself before I'd be heard. Doing that properly costs money and takes expertise, and that cost is exactly where most people stop. They take the deal. They don't file the motion. They lose on paperwork instead of on the merits.

That gap is what the software attacks.

What's in it:

→ Declaration generation — drafts the sworn statement you actually file
→ Exhibit indexing — turns a pile of evidence into an organized, referenced index
→ Timeline builder — reconstructs the chronology out of your own documents
→ Argument builder — builds your argument, then builds the other side's counter-argument and validates your claims against your record
→ Case Q&A — ask questions against everything you've collected and filed
→ Ingestion for documents, audio and video, with transcription, so a hearing recording becomes searchable evidence

This isn't a prototype. It's a production system: a Next.js portal, an orchestration layer running Azure OpenAI and Anthropic models, .NET workers on Kubernetes, Cosmos DB, Azure AI Search, and the full infrastructure-as-code that stands it all up across two environments.

The argument builder is the part I'm proudest of. It argues against you. That is what a good attorney does for a client in the first meeting — tell you where you're weak before opposing counsel does. It's also the one thing a self-represented litigant never gets.

I'm not going to pitch this. The code and the infrastructure that runs it will be public. If you write software and want to work on something with actual stakes, there's plenty to do. If you run a legal aid clinic or a self-help center, it's yours to deploy — no license fee, no conversation with me required.

I'd rather it help one person I never meet than stay mine.

---
