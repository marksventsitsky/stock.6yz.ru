import dns from "node:dns";

// In some environments Node/undici may pick an unreachable IPv6 address first and hang on connect.
// Prefer IPv4 to avoid broken/partial IPv6 routes.
dns.setDefaultResultOrder("ipv4first");

