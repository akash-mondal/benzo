/**
 * Console invite claim. Team invite links are business-scoped org links; accepting
 * one creates or activates the invited console member in the inviting workspace.
 */
import { useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Check, UserPlus, X } from "lucide-react";
import { assertAppScope, parseBenzoLink, WrongAppError, type OrgInviteLink } from "@benzo/links";
import { api } from "../lib/api";
import { friendlyError } from "../lib/format";
import { Page } from "../ui/motion";
import { Button, Card, Pill } from "../ui/primitives";

type Parsed =
  | { ok: true; link: OrgInviteLink }
  | { ok: false; title: string; hint: string };

function linkFromHash(hash: string): string | null {
  const raw = hash.replace(/^#/, "");
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function parseInvite(raw: string | null): Parsed {
  if (!raw) return { ok: false, title: "Invite link missing", hint: "Ask the sender to share the invite again." };
  const link = parseBenzoLink(raw);
  if (!link || link.type !== "org") {
    return { ok: false, title: "Invite link is incomplete", hint: "Ask the sender to create a fresh team invite." };
  }
  try {
    assertAppScope(link, "business");
  } catch (e) {
    const scope = e instanceof WrongAppError ? e.linkScope : "another app";
    return { ok: false, title: "Wrong app", hint: `This is a Benzo ${scope} link. Open it in the matching Benzo app.` };
  }
  if (link.kind !== "member") {
    return { ok: false, title: "Open this in Wallet", hint: "Contractor and customer invites are accepted from the Wallet app." };
  }
  return { ok: true, link };
}

export function InviteClaim() {
  const [params] = useSearchParams();
  const loc = useLocation();
  const nav = useNavigate();
  const raw = useMemo(() => params.get("link") ?? linkFromHash(loc.hash), [params, loc.hash]);
  const parsed = useMemo(() => parseInvite(raw), [raw]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!parsed.ok) {
    return (
      <Page className="mx-auto flex min-h-[70vh] max-w-lg items-center justify-center">
        <Card className="w-full p-8 text-center" data-testid="console-invite-error">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-danger/10 text-danger"><X size={26} /></div>
          <h1 className="mt-4 font-display text-2xl">{parsed.title}</h1>
          <p className="mt-2 text-sm text-muted">{parsed.hint}</p>
          <Button className="mt-5" variant="outline" onClick={() => nav("/")}>Back to console</Button>
        </Card>
      </Page>
    );
  }

  const invite = parsed.link;
  const org = invite.orgName ?? "this workspace";
  const role = invite.role ?? "member";
  const name = invite.inviteeName ?? "Team member";

  async function accept() {
    setBusy(true);
    setErr(null);
    try {
      await api.acceptInvite({ token: invite.token, name });
      setDone(true);
    } catch (e) {
      setErr(friendlyError(e, "Couldn't accept this invite. Ask the sender to create a fresh link."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page className="mx-auto flex min-h-[70vh] max-w-lg items-center justify-center">
      <Card className="w-full p-8 text-center" data-testid="console-invite-claim">
        <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${done ? "bg-success/10 text-success" : "bg-primary/10 text-primary"}`}>
          {done ? <Check size={30} /> : <UserPlus size={30} />}
        </div>
        <h1 className="mt-4 font-display text-2xl">{done ? "Invite accepted" : `${org} invited you`}</h1>
        <p className="mt-2 text-sm text-muted">
          {done
            ? "Your team seat is active. You can now help review and release private payments."
            : `${name} will join as ${role}. Benzo keeps the workspace key separate from your personal wallet.`}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Pill tone="primary">{role}</Pill>
          <Pill tone="muted">Business</Pill>
        </div>
        {err ? <p className="mt-4 text-sm text-danger" data-testid="console-invite-claim-error">{err}</p> : null}
        {done ? (
          <Button className="mt-6" onClick={() => nav("/settings")} data-testid="console-invite-open-settings">
            View team <ArrowRight size={15} />
          </Button>
        ) : (
          <Button className="mt-6" loading={busy} onClick={accept} data-testid="console-invite-accept">
            Accept invite
          </Button>
        )}
      </Card>
    </Page>
  );
}
