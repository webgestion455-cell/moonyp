import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { MessageCircle } from "lucide-react";

export const Route = createFileRoute("/admin/chat/")({
  component: AdminChatIndex,
});

function AdminChatIndex() {
  const { t } = useTranslation();
  return (
    <div className="h-full grid place-items-center rounded-2xl border border-border bg-card text-center p-8">
      <div>
        <MessageCircle className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">{t("chat.admin.selectHint")}</p>
      </div>
    </div>
  );
}
