import { expect, test } from "@playwright/test";

test("demo studio presents the complete OBS setup flow", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Your chat belongs/ }),
  ).toBeVisible();
  await expect(page.getByText("Demo studio")).toBeVisible();
  await expect(page.getByText("Add to OBS")).toBeVisible();
  await page.getByRole("button", { name: "Terminal" }).click();
  await expect(page.locator(".chat-canvas")).toHaveClass(/preset-terminal/);
  await page.getByRole("button", { name: /Test message/ }).click();
  await expect(page.locator(".chat-message")).toHaveCount(4);
});

test("overlay route is transparent and OBS-sized", async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 700 });
  await page.goto("/overlay/demo?demo=1");
  await expect(page.locator(".chat-message")).toHaveCount(3);
  const backgrounds = await page.evaluate(() => [
    getComputedStyle(document.documentElement).backgroundColor,
    getComputedStyle(document.body).backgroundColor,
  ]);
  expect(backgrounds).toEqual(["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"]);
  await expect(page.locator("img.emote")).toHaveAttribute(
    "src",
    /static-cdn\.jtvnw\.net/,
  );
});
