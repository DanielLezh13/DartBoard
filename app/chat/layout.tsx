import { ChatRouteKeyWrapper } from "@/components/ChatRouteKeyWrapper";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ChatRouteKeyWrapper>{children}</ChatRouteKeyWrapper>;
}
