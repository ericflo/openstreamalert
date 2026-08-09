import { expect, test } from "@playwright/test";

test("public demo is self-contained and its overlay survives a direct load", async ({
  page,
}) => {
  const remoteRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.origin !== "http://127.0.0.1:4174" &&
      url.hostname !== "static-cdn.jtvnw.net"
    )
      remoteRequests.push(request.url());
  });

  await page.goto("./");
  await expect(page.getByText("Public demo", { exact: true })).toBeVisible();
  await expect(page.getByText("Try every design control")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Your chat belongs/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Terminal" }).click();
  await page.getByRole("slider", { name: "Text size" }).fill("31");
  const overlayUrl = await page.locator(".url-field code").textContent();
  expect(overlayUrl).toContain("/openstreamalert/overlay/demo?demo=1&config=");
  expect(remoteRequests).toEqual([]);

  await page.goto(overlayUrl!);
  await expect(page.locator(".chat-canvas")).toHaveClass(/preset-terminal/);
  await expect(page.locator(".chat-canvas")).toHaveCSS("font-size", "31px");
  await expect(page.locator("html")).toHaveAttribute("data-route", "overlay");
  expect(remoteRequests).toEqual([]);
});
