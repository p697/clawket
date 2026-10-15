# Native media

Root and Apple package rules apply. This module owns bounded local files and ImageIO preparation, independent of UIKit and backend credentials. Stage NSItemProvider temporary file URLs synchronously before their callbacks return; the host owns security-scoped document access and NSFileCoordinator. Persist owned UUID resource references, never external picker URLs or base64 in presentation state.

Source imports are at most 32 MiB, prepared prompt items 5 MiB, generated artifacts 10 MiB in exact 128 KiB chunks. The whole RPC's 8 MiB limit belongs to Runtime/Transport and must be checked separately. Preserve GIF bytes and PNG transparency; ImageIO downsamples before decoding full-resolution pixels. Reject SVG/HTML as inline raster images. Draft files are deleted only explicitly; cached artifacts expire after 24 hours and remain retained through sharing completion. Scope invalidation cancels pending cache work, and late chunks cannot commit. Library corruption never becomes an empty library.

Keep source URLs, filenames, file bytes and remote artifact references out of diagnostics. Only a captured Runtime artifact handle may supply cache chunks; never fetch an arbitrary transcript path or URL. Follow resource leases before compiling or running tests.

A persisted staged receipt is metadata only; `recover` must revalidate its exact owned UUID file and hash before adoption. `previewInput` normalizes high-resolution/HEIC source photos through bounded preparation; do not relax generated-artifact MIME/pixel limits to preview input originals.
