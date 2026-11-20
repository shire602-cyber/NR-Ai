/**
 * Obviously fake credentials for tests. None of these is, or ever was, a real account secret.
 * Each value names itself as fake ("Fake", "Password", "Test") so secret scanners (GitGuardian
 * "Generic Password") and readers can tell a fixture from a leaked credential.
 *
 * tests/unit/no-real-looking-test-passwords.test.ts rejects new password literals in tests/ and
 * scripts/ that do not carry such a marker; import from here instead.
 */
export const FAKE_PASSWORD = "Fake-Password-123";
