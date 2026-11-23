import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GroupChips, RoleBadge } from "./badges";

const g = (name: string, is_system = false) => ({ id: name, slug: name.toLowerCase(), name, is_system });

describe("badges", () => {
  it("labels roles", () => {
    render(
      <>
        <RoleBadge role="admin" />
        <RoleBadge role="member" />
      </>,
    );
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Member")).toBeInTheDocument();
  });

  it("collapses long group lists", () => {
    render(<GroupChips groups={[g("A"), g("B"), g("C"), g("D"), g("E")]} max={3} />);
    expect(screen.getByText("+2")).toHaveAttribute("title", "D, E");
  });

  it("can hide the system group", () => {
    render(<GroupChips groups={[g("Everyone", true)]} hideSystem />);
    expect(screen.getByText("No groups")).toBeInTheDocument();
  });
});
