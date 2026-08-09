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

When GitHub displays **Security → Report a vulnerability**, use it to open a
private security advisory. GitHub does not currently expose that feature on this
private repository plan. Until it is available, request a private contact
channel through the maintainer's GitHub profile or open an issue containing no
vulnerability details. Never paste credentials or include a live overlay URL.

Include the affected commit, impact, smallest reproduction, and any suggested
mitigation. You should receive an acknowledgement within three business days.
The maintainer will coordinate validation, a fix, disclosure timing, and credit
with you.

## Operator responsibilities

OpenStreamAlert minimizes requested Twitch permissions and encrypts OAuth
credentials at rest. Operators are responsible for protecting their
`ENCRYPTION_KEY`, Twitch client secret, database, and overlay URLs; terminating
TLS at a trusted reverse proxy; and keeping dependencies current.

The overlay key grants read-only access to a rendered view of public chat. If it
is shared accidentally, rotate it in the studio. Rotation invalidates the old
URL immediately.
