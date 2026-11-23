import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DemoUser } from "@/lib/api/client";
import { DemoUserList } from "./demo-users";

const everyone = { id: "g0", slug: "everyone", name: "Everyone", is_system: true };
const users: DemoUser[] = [
  {
    id: "u1",
    name: "Nadia Rahman",
    title: "Operations Coordinator",
    role: "member",
    groups: [everyone, { id: "g1", slug: "ops", name: "Ops", is_system: false }],
  },
  {
    id: "u3",
    name: "Tariq Haddad",
    title: "Engineering Lead",
    role: "admin",
    groups: [everyone],
  },
];

describe("DemoUserList", () => {
  it("shows each user's role and groups, hiding the implicit Everyone group", () => {
    render(<DemoUserList users={users} loading={false} pendingId={null} onSelect={vi.fn()} />);
    const nadia = screen.getByRole("button", { name: /Nadia Rahman/ });
    expect(nadia).toHaveTextContent("Member");
    expect(nadia).toHaveTextContent("Ops");
    expect(nadia).not.toHaveTextContent("Everyone");
    expect(screen.getByRole("button", { name: /Tariq Haddad/ })).toHaveTextContent("Admin");
  });

  it("signs in as the chosen user", async () => {
    const onSelect = vi.fn();
    render(<DemoUserList users={users} loading={false} pendingId={null} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: /Tariq Haddad/ }));
    expect(onSelect).toHaveBeenCalledWith(users[1]);
  });

  it("locks the list while a sign-in is in progress", () => {
    render(<DemoUserList users={users} loading={false} pendingId="u1" onSelect={vi.fn()} />);
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  });

  it("handles an empty organization", () => {
    render(<DemoUserList users={[]} loading={false} pendingId={null} onSelect={vi.fn()} />);
    expect(screen.getByText("No demo users are available yet.")).toBeInTheDocument();
  });
});
