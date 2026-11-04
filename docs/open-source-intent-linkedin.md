# ProBono Law — statement of intent (LinkedIn)

Post one of two. This goes out **before** any code is public; it states the intent and
the destination. The release post in `open-source-announcement-linkedin.md` goes out
once the repositories are live at https://github.com/ProBonoLaw.

Publish only after the organization exists and the URL resolves.

---

I'm open sourcing ProBono Law. The code isn't public yet, and I'd rather say plainly what I'm doing before I do it than announce it after the fact.

I built it so people who can't afford a lawyer have a real chance in court. I couldn't raise investment, and I'm not much good in the rooms where that happens. So the choice was to keep grinding on it privately, or give it away and let it do the thing it was built to do. I'm giving it away.

Why it exists is personal. I went through a custody fight as a father. I'm not putting my case on LinkedIn. What I will say is that I walked in feeling I had to disprove something about myself before anyone would listen, and that doing that properly takes money and expertise most people don't have. That is where people stop. They take the deal. They miss the filing. They lose on procedure rather than on the facts.

The software goes after that gap. It drafts the declarations you actually file, indexes your exhibits, rebuilds a timeline out of your own documents, and answers questions against your own case record. It takes in documents, audio and video, so a hearing recording becomes searchable evidence. And it includes an argument builder that constructs the other side's case against you, so you find out where you're weak before opposing counsel does.

It's a working production system, not a demo.

Here's the honest reason it isn't public today. It has been running as private infrastructure, wired into a live Azure environment, and the repositories still carry the identifiers and configuration that come with that. Publishing them as-is would be careless. So I'm scrubbing them, licensing the work under Apache 2.0, and moving everything to a new home:

https://github.com/ProBonoLaw

I'd rather take the extra weeks and release something a clinic can actually deploy than rush out a repository I'd have to apologize for.

When it's up, it's up. No signup, no waitlist, nothing to join. If you write software, there will be work worth doing. If you run a legal aid clinic or a self-help center, it will be yours to run — free, and without needing to talk to me first.

I'd rather this help one person I never meet than stay mine.

---
