import ChatPage from "./chat/page";
import { ChatRouteKeyWrapper } from "@/components/ChatRouteKeyWrapper";

// Canonical product entrypoint.
// The marketing surface is mounted via /home (and /(marketing)) to support iframe embedding.
export default function Page() {
  return (
    <ChatRouteKeyWrapper>
      <ChatPage />
    </ChatRouteKeyWrapper>
  );
}
