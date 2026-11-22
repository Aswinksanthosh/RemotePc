# Project health check

Run this after a long stretch of fast coding (vibe coding), before you tell people to use the project. Ask Claude: "Do the health check in HEALTH-CHECK.md and give me a top 10." Keep the answers honest: **checked** (a tool or a test proved it), **read** (looked at the code), or **guess**.

## 1. Does it really work?
- [ ] All tests pass (`npm test` or the project's test command). Note the count.
- [ ] A fresh install from scratch works (new folder / new machine / new phone).
- [ ] Features that touch real hardware or real services were tried by a person on the real thing. List the ones that were only tested with fake answers.
- [ ] The README steps are followed word for word by someone new and still work.

## 2. Security and privacy
- [ ] No keys, tokens, passwords, personal names, emails or addresses in the repo or its history (search them). Real secrets live only in a private place.
- [ ] Install and update download only things that are checked (checksum or signature), from a fixed version, not "whatever is on main".
- [ ] Inputs from outside (web requests, files, command arguments) are checked before use; nothing is run as a command from outside text.
- [ ] Secrets are not placed in web addresses, logs or error messages.
- [ ] Anything that needs admin rights is limited to one fixed action.

## 3. Failures are visible
- [ ] Search for silent error handling (`catch {}`, `|| true`, ignored return codes). Each one is either truly harmless or logs something.
- [ ] When a feature cannot work, the user sees a short plain sentence saying why and what to do.
- [ ] There is a diagnostics page, log or status line the user can send you.
- [ ] A crash restarts itself, or the user is told.

## 4. Code health
- [ ] Biggest files and functions (anything over about 300 lines in one function, 800 in one file) are split by feature.
- [ ] Linter runs clean and runs in CI.
- [ ] No dead code, old experiments or unused files and dependencies. Dependencies are few and up to date.
- [ ] Every important module has a test file.
- [ ] Notes for the next person exist (a context or notes file) and match the code.

## 5. Users
- [ ] Text is short, plain, one language, no jargon. Errors say what to do next.
- [ ] Accessibility: buttons have names, focus is visible, colours have contrast, animations respect "reduce motion", tap targets are big enough.
- [ ] Works offline or on a bad connection without a blank screen.
- [ ] Screenshots, docs and demo videos match the current look.

## 6. Release and maintenance
- [ ] Versions are numbered and tagged; updates can be rolled back.
- [ ] Uninstall removes everything the install added (files, tasks, shortcuts, firewall rules, settings).
- [ ] Licence, third-party credits and contact or issue link are present.

## Report format
Give a **top 10** ordered by risk: 1 to 4 "fix before people use it", 5 to 8 "fix soon", 9 to 10 "nice to have". For each: the problem in plain words, why it matters, how it was found (checked / read / guess), and the smallest fix.
