# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Searching no longer stalls or fails when Tripadvisor is slow. Enrichment now runs in the background instead of holding up the response, so results come back immediately and a degraded Tripadvisor only makes listings less fresh rather than making search unavailable. ([#190](https://github.com/Mateja97/roamly/pull/190))
- Opening a malformed activity link now returns a clear "invalid activity id" message instead of a generic server error. ([#189](https://github.com/Mateja97/roamly/pull/189))
- Activity photos now appear on the detail screen's hero carousel. They were loading correctly but rendering at zero width, showing an empty gradient. ([#193](https://github.com/Mateja97/roamly/pull/193))
- The admin panel no longer flashes the app's dark wine background. Overscrolling or viewing a short page showed wine behind the cream admin surface. ([#192](https://github.com/Mateja97/roamly/pull/192))
- The Feed header now uses the standard body typeface. It was rendering in the Marcellus display font at a size the design system does not sanction. ([#194](https://github.com/Mateja97/roamly/pull/194))
- `activities-service` now starts against a database whose schema has drifted ahead of its migration history, instead of failing on startup with no recovery path. ([#196](https://github.com/Mateja97/roamly/pull/196))

### Changed

- An active minimum-rating filter is now visible on the Feed. The scope pill shows the applied rating (for example `Nearby · 4.5+`) and reads it out to screen readers, so the filter is no longer invisible once the scope sheet closes. ([#195](https://github.com/Mateja97/roamly/pull/195))
