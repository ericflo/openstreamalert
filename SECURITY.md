# Security policy

Please report vulnerabilities privately through GitHub's security advisory
feature rather than opening a public issue.

OpenStreamAlert minimizes requested Twitch permissions and encrypts OAuth
credentials at rest. Operators are responsible for protecting their
`ENCRYPTION_KEY`, Twitch client secret, database, and overlay URLs; terminating
TLS at a trusted reverse proxy; and keeping dependencies current.

The overlay key grants read-only access to a rendered view of public chat. If it
is shared accidentally, rotate it in the studio. Rotation invalidates the old
URL immediately.

