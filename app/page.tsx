
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

export default async function Home() {
  const { userId } = await auth();

  // If user is signed in, go to dashboard
  if (userId) {
    redirect("/dashboard");
  }

  // If not signed in, go to sign-up page
  redirect("/Sign-up");
}
