import type { Metadata } from "next";
import { Landing } from "./landing";

export const metadata: Metadata = {
  title: "Thinq — answers your team can trust",
  description:
    "Open-source organizational knowledge: approved documents first, access checked on every request, every answer cited.",
};

export default function WelcomePage() {
  return <Landing />;
}
