# Steer release source for prepublication CI

`aiterm-steer-delivery-0.5.0.tgz` is the normal `npm pack` output of the fixed
producer commit in `steer-release-source.json`, after `npm run build`.
The source PR is https://github.com/kitepon/aiterm-steer-delivery/pull/1.

Aiterm's source dependency is `^0.5.0`; its lockfile points at the normal npm
registry URL and this exact tarball integrity. Before Steer is published, CI
seeds these reviewed bytes into its own checkout-local npm cache, then runs
ordinary `npm ci` against the unchanged lockfile. It does not install 0.4.7,
rewrite package metadata, or silently fetch a different producer branch.
The archive and receipt are excluded from the published Aiterm npm package by
its existing files list.

These tests validate the fixed producer/consumer source pair. They do not
claim registry availability or npm provenance. After publishing Steer, check
that the registry tarball has this integrity before Aiterm publication; if
publication changes the artifact, update the lock and rerun the affected gate.
