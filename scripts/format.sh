#!/bin/sh
# See apps/docs/lint-format/tech.md §2.2.
bin=node_modules/.bin
$bin/oxlint --fix --silent --no-error-on-unmatched-pattern -A prefer-const -A no-var "$@"
$bin/oxlint --fix --silent --no-error-on-unmatched-pattern "$@"
$bin/oxfmt --no-error-on-unmatched-pattern "$@"
