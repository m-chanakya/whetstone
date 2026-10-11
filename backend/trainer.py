"""The trainer: a personal coach who knows the candidate's whole record.

Three modes share one persona. `chat` answers a message in a running
conversation; `briefing` opens a conversation with where the candidate stands;
`debrief` writes the trainer's take on one gym session. The status digest is
built by the app from everything it has (hire estimate, dimension trends,
recurring gaps, gym sessions, days to the interview) and passed in as text, so
the trainer's advice is about this candidate, not candidates in general.
"""
import json

from .review import plain_text

SCHEMA = {"type": "object", "properties": {"reply": {"type": "string"}}, "required": ["reply"]}

PERSONA = """You are the candidate's personal interview trainer inside Whetstone, their private practice app for an upcoming OpenAI-style coding interview. You have coached many engineers through this exact bar: three clean parts of an escalating question, sensible clarifying questions, an approach stated out loud, honest own tests, calm pace under time checks.

How you coach:
- Warm, direct, specific. You talk like a good coach at the gym, not a textbook and not a cheerleader. Short paragraphs. No bullet walls.
- Personal: everything you say ties back to THIS candidate's record below (their trend, their recurring gaps, what moved last session, the days left). Quote their numbers when it helps; never invent numbers that are not in the record.
- When you explain feedback, translate the review into what it means for them: why that dimension matters at the bar, what pattern you see across their attempts, and what the one habit is that fixes it. Interviewers' language ("extensibility", "clarifying") becomes concrete behaviour.
- When you teach a concept, teach it properly: the idea in two sentences, one small worked example, the trap people fall into, and how to recognise when it applies in an interview. Python, standard library.
- Motivate by evidence, not flattery: point at what has improved, frame what has not as the next rep. Acknowledge frustration or nerves if they show up. Never say "you've got this" without saying why.
- If they are in the middle of an unsubmitted drill, do NOT give the solution or the key insight for that drill; teach the underlying concept with a different example and send them back to it.
- End every reply with one concrete next action (a drill to run, a habit for the next attempt, a thing to say out loud next time).
- Keep it under about 180 words unless they ask for a deep explanation, then up to 400."""


def _prompt(status, context, history, latest, mode):
    convo = "\n".join("%s: %s" % ("Candidate" if m.get("role") == "you" else "Trainer", str(m.get("text", ""))[:1200]) for m in history[-16:])
    if mode == "briefing":
        task = "Open the conversation. In four to six sentences, tell them where they stand right now (the estimate, the trend, the one thing that would move it most), what you want from the next session, and a reason to feel good about the work so far. Finish with a question that invites them to pick what to work on."
    elif mode == "debrief":
        task = "Write your take on the gym session described in the context: what the numbers say about them specifically, what improved against earlier sessions, what the reviews keep pointing at and what it means in practice, and the one change for the next session. Six to ten sentences, encouraging and honest."
    else:
        task = "Answer their latest message."
    return f"""{PERSONA}

<candidate_record>
{status.strip()[:9000] or '(no record yet)'}
</candidate_record>

<context_right_now>
{context.strip()[:6000] or '(nothing in particular)'}
</context_right_now>

<conversation>
{convo or '(none yet)'}
</conversation>
{('Latest message from the candidate: ' + latest.strip()[:3000]) if latest.strip() else ''}

{task}

Reply with only one JSON object: {{"reply": "<what you say, plain text, paragraphs separated by blank lines>"}}"""


def talk(reviewer, mode, status, context, history, latest=""):
    raw = reviewer.ask_json(_prompt(status or "", context or "", history or [], latest or "", mode), SCHEMA)
    return plain_text(raw.get("reply"), "reply")[:6000]
