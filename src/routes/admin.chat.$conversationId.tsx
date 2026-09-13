import { createFileRoute } from "@tanstack/react-router";
import { useAdminT } from "@/hooks/use-admin-t";
import { ChatWindow } from "@/components/chat/ChatWindow";

export const Route = createFileRoute("/admin/chat/$conversationId")({
  component: AdminChatConversation,
});

function AdminChatConversation() {
  const { conversationId } = Route.useParams();
  return <ChatWindow conversationId={conversationId} mode="agent" className="h-full" />;
}

// Index (no selection)
export const IndexRoute = null;
