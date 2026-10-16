// R71 (B37 leak audit, real findings 1–3): evidence never carries a full shielded or transparent destination — a
// refund/output address in committed evidence links a payout to its recipient. Writers that capture raw tool output
// pass it through here; the abbreviated form keeps enough to cross-reference within one evidence directory.
const ADDRESS = /\b(?:utest1|u1|ztestsapling1|zs1|tm|t1|tex1)[0-9a-z]{30,}\b/gi;
export const redactAddresses = (text: string): string => text.replace(ADDRESS, (a) => `${a.slice(0, 10)}…${a.slice(-6)}`);
