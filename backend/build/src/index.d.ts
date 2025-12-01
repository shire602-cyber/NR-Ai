declare module 'http' {
    interface IncomingMessage {
        rawBody: unknown;
    }
}
export {};
