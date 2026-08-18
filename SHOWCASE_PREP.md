# Showcase prep — what to say out loud

Plain-English talking points. Each section is meant to be spoken, not read as documentation.

---

## 1. Full request flow

A student types in the chat bubble that our Moodle plugin puts on every page. That JavaScript does **not** talk to the AI company itself. It first calls our own backend and immediately saves the question, so another browser tab can already show “thinking.” Then the backend does the real work: it pulls this course’s materials from Moodle, builds instructions for the assistant, and sends the question to whichever AI provider the student picked. The AI’s reply comes back to our backend, gets saved with the conversation, and the widget paints it on screen. If the student asked to create a quiz or study guide, this first round only returns a preview card — Moodle is not changed until they hit Confirm.

---

## 2. Grounding answers in real course content

Before it answers, the system reads what is actually in this Moodle course: the course description, week/section summaries, activity descriptions, full Page resources, assignment instructions and their attached files, forum and announcement posts, and downloadable files. PDFs are opened and the text is pulled out; plain text and JSON files are read as-is; other file types only contribute a filename so we do not pretend we read a video or a spreadsheet we cannot parse. That snapshot is cached for **fifteen minutes**, so we are not re-downloading every PDF and forum thread on every question, but a teacher who just posted notes will show up without a reboot. Matching is simple: it prefers the week the student is chatting about, then boosts chunks whose words overlap the question, and it only sends the top slice of that material into the prompt.

---

## 3. Multi-provider AI switching

The chat has one internal contract: “send a conversation” and “give me structured JSON.” Google Gemini, Anthropic Claude, OpenAI, xAI Grok, and Mistral all implement that same contract, so the rest of the app does not care which logo is selected. OpenAI, Grok, and Mistral even share one adapter, because those three speak nearly the same API. The student (or a demo operator) picks a provider in the widget; that choice rides along on the next message. If a key is missing, that option is listed as unavailable rather than crashing the site. **Gemini’s two files are not two products:** one is a thin Google SDK wrapper that holds the API key and model name; the other is the adapter that translates our generic chat, tools, and JSON requests into Gemini’s particular format so Gemini can sit beside Claude and ChatGPT.

---

## 4. The “confirm before creating” pattern

The AI is good at drafting, and bad at being a trusted button that writes into a live course. So when a student says “make me a practice quiz,” the model is only allowed to **propose** a title, topic, size, and difficulty. That proposal is stored as a **pending** record: it belongs to that student and that chat, it is not a Moodle activity yet, and it expires in twenty minutes if they walk away. The widget shows the preview with Confirm and Cancel, and they can still edit the title, question or card count, and quiz difficulty. Only Confirm generates the real questions or notes and then creates something in Moodle; Cancel (or expiry) means nothing was ever added to the course.

---

## 5. Private AI Content (flashcards, study guides, practice quizzes)

Created items land in a shared course section named **AI Content**, but each item is locked to a **private Moodle group that contains only that student**. Other students do not even see a greyed-out tile; instructors still can, which is the usual teaching view. Study guides and flashcards are both Moodle **Pages** — a web page of notes, or a page of flip-cards — created through the same “create a private page” path. Practice quizzes are a different Moodle activity: a real **Quiz**, with real multiple-choice and true/false questions in the question bank, unlimited practice attempts, and the grade **zeroed out of the course total** so it cannot quietly change someone’s mark. Same privacy trick, different tool, because a quiz needs attempts and scoring and a page of notes does not.

---

## 6. Coach Mode vs Direct Mode

**Direct** tells the model: answer the question. **Coach** tells it: do not dump the full answer on conceptual or problem-solving questions; make the student reason with follow-up questions, counters, and hints, and only confirm the conclusion after they have worked toward it. Coach also has a 1–5 guidance slider: 1 is almost only questions, 3 is a mix of questions and light hints, 5 is heavy scaffolding that is almost a worked solution but still asks the student to say the last step. Coach has a hard exception: deadlines, where to click, what an announcement said, and other lookup facts are answered straight, because Socratic method on “when is this due?” is just annoying. The mode is stored on the message, so a chat can switch mid-conversation.

---

## 7. Attachments

Students can attach common study files — PDFs, Word, PowerPoint, spreadsheets, zip archives, ebooks, and source/code/text files — up to ten files, fifty megabytes each. Images, audio, and video are refused for now, because we cannot read them yet. On upload the file is stored, text is extracted, and that text is split into overlapping chunks so a huge PDF does not have to be stuffed into the AI all at once. When they send the message, the backend picks the chunks that best match the question (and prefers the files from this turn), and pastes those excerpts under the student’s words so the model is reading the file, not guessing from the filename.

---

## 8. Three hard technical problems (if asked “what was hardest?”)

**Stopping the AI from writing into the live course.** Large language models will cheerfully “create a quiz” in text even when the student only asked a question, and a Moodle quiz is a real graded object. We split “propose” from “write”: the model can only fill in a preview, and a stored pending record plus an explicit Confirm is what actually creates anything.

**Making five AI vendors feel like one switch.** Each company has different rules for tools, JSON, and even whose turn is allowed to come first in a chat. We hid that behind one contract, reused one adapter for three OpenAI-style vendors, and kept Google’s SDK in a separate thin client so swapping models does not mean rewriting quizzes, flashcards, or the chat itself.

**Private per-student content without building a second LMS.** The obvious shortcut is a database only we control. Instead we create real Moodle Pages and Quizzes, put each student in their own group, and use Moodle’s own “only this group can see this” rule — so the mobile app, backups, and teachers still work, and classmates cannot see someone else’s practice quiz.

---

## 9. Honest fragility check

- **The backend trusts the Moodle user id the browser sends.** There is no student login token on our API. On a shared network, a technical judge could impersonate another user id if they can reach the service.
- **Course material can be up to fifteen minutes stale**, lives in memory on one server, and matching is basically “which chunks contain the same words.” A brand-new upload, a scanned PDF with no selectable text, or a question that uses different wording than the notes can all miss.
- **The service talks to Moodle as a privileged integration account**, not as the student. It can read whatever that account can read, which may be more than the student is allowed to see.
- **Turning this on can enable course groups** if the course had none, and flashcards vs study guides are distinguished by sniffing HTML class names — both are shortcuts a Moodle admin would notice.
- **Images still cannot be read**, JSON from some vendors is “please return JSON” rather than a guaranteed schema, and Gemini sometimes returns a blank reply when safety filters fire. Those are known edges, not mysteries.
