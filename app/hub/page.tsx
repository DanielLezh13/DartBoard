import { redirect } from "next/navigation";

// Legacy entry route kept for old links. Canonical entrypoint is "/".
export default function HubPage() {
  redirect("/");
}
