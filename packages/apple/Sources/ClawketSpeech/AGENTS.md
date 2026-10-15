# Native speech

Root and Apple package rules apply. Preserve the current Mobile/Worker speech protocol; do not change the server. Record only on explicit intent, using the existing device signing identity. Signed headers never appear in diagnostics. Speech URLs are explicit build configuration; an unconfigured integration stays unavailable in community builds.

Keep protected PCM on-device before upload, bounded to ten 600-second recordings. Never silently evict unfinished audio. Scope recovery by the original connection/Agent/session; exact legacy flat scope comparison needs an explicit target, never a guessed split. Durable segment checkpoints precede advancing to the next 110-second provider task. Only pre-ready speech_busy may retry automatically; an accepted task or lost final response never replays automatically.

Only explicit microphone start may create an engine/input node or configure/activate its audio session. Mix with existing music without ducking or HFP routing; stop/error/cancellation/background release immediately. Capture cleanup belongs to its attempt and must finish before a successor starts. Bounded capture overflow stops safely, never silently drops audio.

Close, Cancel, background and transcription Retry retain audio and never send chat. An explicit finishAndSend is scoped to its original fresh capture, activation and draft revision; cancellation/interruption clears it permanently. A transcript is editable text, never permission to overwrite a later draft or to dispatch a restored recording. Physical microphone/music/route and cloud acceptance remain separate from injected tests and compilation.
