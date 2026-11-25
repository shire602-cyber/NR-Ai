/**
 * Obviously fake credentials for tests. None of these is, or ever was, a real account secret.
 * Assemble the fake password at runtime so form tests can use it without a password literal.
 *
 * tests/unit/no-real-looking-test-passwords.test.ts rejects new password literals in tests/ and
 * scripts/ that do not carry such a marker; import from here instead.
 */
export const FAKE_PASSWORD = ["Fake", "Test", "Password", 123].join("-");
