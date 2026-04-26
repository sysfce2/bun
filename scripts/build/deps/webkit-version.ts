/**
 * WebKit commit — determines prebuilt download URL + what to checkout
 * for local mode. Override via `--webkit-version=<hash>` to test a branch.
 * From https://github.com/oven-sh/WebKit releases.
 *
 * Lives in its own module (no imports) so `config.ts` can read it without
 * pulling in `deps/webkit.ts`'s transitive imports — that chain runs
 * `deps/webkit.ts → flags.ts → config.ts → deps/webkit.ts`, and the
 * cycle leaves `WEBKIT_VERSION` in the temporal dead zone when it's
 * accessed during `config.ts`'s top-level evaluation.
 */
export const WEBKIT_VERSION = "bdf6aab38a9c6f99df3fd1486406ab6b74180fbb";
