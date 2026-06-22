/**
 * Shared screen chrome: the Home top bar (logo + eye + bell) and the sub-screen
 * header (back chevron + title) used by Send / Request / Cash / Share.
 */
import { ChevronLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Logo } from "./Logo";
import { IconButton } from "./primitives";
import { HideToggle } from "./privacy";
import { Bell } from "lucide-react";
import { useWallet } from "../lib/store";
import { unreadCount } from "../lib/notifications";

export function TopBar({ hidden, onToggleHide }: { hidden: boolean; onToggleHide: () => void }) {
  const nav = useNavigate();
  const { history } = useWallet();
  const unread = unreadCount(history);
  return (
    <div className="flex items-center justify-between px-5 pb-2 pt-5">
      <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}>
        <Logo size={30} className="text-ink" />
      </motion.div>
      <div className="flex items-center gap-2.5">
        <HideToggle hidden={hidden} onToggle={onToggleHide} />
        <IconButton badge={unread > 0} aria-label="Notifications" onClick={() => nav("/notifications")} data-testid="bell">
          <Bell size={18} />
        </IconButton>
      </div>
    </div>
  );
}

export function ScreenHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  const nav = useNavigate();
  return (
    <div className="flex items-center gap-2 px-5 pb-1 pt-5">
      <IconButton onClick={() => (onBack ? onBack() : nav(-1))} aria-label="Back">
        <ChevronLeft size={20} />
      </IconButton>
      <h1 className="font-display text-xl">{title}</h1>
    </div>
  );
}
