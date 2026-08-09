# Security policy

## Supported versions

OpenStreamAlert is currently pre-release software. Until the first version is
tagged, security fixes are made only on the latest commit of `main`. Once tagged
releases exist, this table will identify the supported lines explicitly.

| Version       | Supported |
| ------------- | --------- |
| Latest `main` | Yes       |
| Older commits | No        |

## Reporting a vulnerability

Use the repository's **Security → Report a vulnerability** button to open a
[private security advisory](https://github.com/ericflo/openstreamalert/security/advisories/new).
Do not open a public issue, paste credentials, or include a live overlay URL.

Include the affected commit, impact, smallest reproduction, and any suggested
mitigation. You should receive an acknowledgement within three business days.
The maintainer will coordinate validation, a fix, disclosure timing, and credit
with you. If private advisories are unavailable, open a public issue containing
no vulnerability details and ask the maintainer for a private reporting channel.

## Operator responsibilities

OpenStreamAlert minimizes requested Twitch permissions and encrypts OAuth
credentials at rest. Operators are responsible for protecting their
`ENCRYPTION_KEY`, Twitch client secret, database, and overlay URLs; terminating
TLS at a trusted reverse proxy; and keeping dependencies current.

The overlay key grants read-only access to a rendered view of public chat. If it
is shared accidentally, rotate it in the studio. Rotation invalidates the old
URL immediately.
