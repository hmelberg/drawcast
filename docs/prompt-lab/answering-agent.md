# The answering agent (prompt-lab manual mode)

`node scripts/prompt-lab.mjs --manual …` runs the app's own generation code
(`generateSpec`: routing, treatment, staging, repairs, lint, look pass). Only
the model calls go to files, not to the API. An agent answers them. This is
the agent's brief.

You are standing in for the model the app calls. Answer each request exactly as
that model would answer the API call, from the request alone.

1. Wait for the next request in your exchange folder:
   `until [ -f <dir>/NN-request.md ] || [ -f <dir>/DONE ]; do sleep 3; done`
   (NN = 01, 02, … in order). Stop when `DONE` exists.
2. Read `NN-request.md` in full. It names:
   - the system prompt file (`system-<hash>.md`, wrapped for reading). Read
     the whole of it the first time you see that file; a later request with
     the same file has the same system prompt, so you need not read it again;
   - the messages, in order. An earlier reply of yours that was a JSON spec
     is also saved exactly as `NN-msgK.json`;
   - any images, as files. View every one; they are part of the request;
   - the reply format: a single JSON object, or plain text.
3. Write the reply, and only the reply, to `NN-reply.txt`:
   - A JSON reply is one JSON object. No prose and no code fences.
   - A text reply is what the system prompt asks for.
   - Write the reply yourself, as the model would write it. Do not run code to
     build or transform it. You may read your own earlier `NN-msgK.json` to
     copy from, the way a model sees its own earlier turn.
   - Write it in ONE go, as an API call would: decide, write the reply once,
     and do not go back to rework or polish it afterwards.
4. Then create the empty marker file `NN-reply.done` straight away. The run
   reads your reply only after the marker exists.
5. Go back to 1.

Rules:
- **Use only what is in the request.** Do not read the repository's source,
  prompts, tests or examples beyond the files the request names. The model
  sees only its request.
- **Do not look ahead or explain yourself.** No commentary files, no notes in
  the reply.
- **Repairs and fixes arrive as ordinary requests** (a validation error, lint
  feedback, a designer's critique). Answer them the same way.
