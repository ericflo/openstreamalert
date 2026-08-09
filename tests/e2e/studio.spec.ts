import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

async function openDemoStudio(page: Parameters<typeof test>[0]["page"]) {
  await page.goto("/");
  await expect(page.getByText("Demo studio")).toBeVisible();
}

test("demo studio presents the complete OBS setup flow", async ({ page }) => {
  await openDemoStudio(page);
  await expect(
    page.getByRole("heading", { name: /Your chat belongs/ }),
  ).toBeVisible();
  await expect(page.getByText("Add to OBS")).toBeVisible();
  await page.getByRole("button", { name: "Terminal" }).click();
  await expect(page.locator(".chat-canvas")).toHaveClass(/preset-terminal/);
  await expect(page.locator(".chat-canvas")).toHaveClass(/font-mono/);
  await page.getByRole("button", { name: /Test message/ }).click();
  await expect(page.locator(".chat-message")).toHaveCount(4);
});

test("the demo OBS URL carries the exact customized configuration", async ({
  page,
}) => {
  await openDemoStudio(page);

  await page.getByRole("button", { name: "Terminal" }).click();
  await page.getByRole("slider", { name: /Text size/ }).fill("32");
  await page.getByRole("slider", { name: /Panel opacity/ }).fill("0.43");
  await page.getByLabel("Accent").fill("#12ab34");
  await page.getByRole("checkbox", { name: "Timestamps" }).check();
  await page.getByRole("checkbox", { name: "New at top" }).check();
  await page.getByLabel(/Hidden users/).fill("nightbot, spam_account");
  await page.getByLabel(/Hidden words/).fill("spoiler, unwanted phrase");

  const demoUrl = await page.locator(".url-field code").getAttribute("title");
  expect(demoUrl).toBeTruthy();
  const encoded = new URL(demoUrl!).searchParams.get("config");
  const decoded = JSON.parse(
    Buffer.from(encoded!, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
  expect(decoded).toMatchObject({
    preset: "terminal",
    font: "mono",
    fontSize: 32,
    backgroundOpacity: 0.43,
    accent: "#12ab34",
    showTimestamps: true,
    direction: "top",
    blockedUsers: ["nightbot", "spam_account"],
    blockedWords: ["spoiler", "unwanted phrase"],
  });

  await page.goto(demoUrl!);
  const canvas = page.locator(".chat-canvas");
  await expect(canvas).toHaveClass(/preset-terminal/);
  await expect(canvas).toHaveClass(/font-mono/);
  await expect(canvas).toHaveClass(/direction-top/);
  await expect(canvas.locator("time")).toHaveCount(3);
  await expect(canvas).toHaveCSS("font-size", "32px");
  await expect(canvas).toHaveCSS("--panel-alpha", "0.43");
  await expect(canvas).toHaveCSS("--accent", "#12ab34");
});

test("configuration JSON round-trips through import and export", async ({
  page,
}) => {
  await openDemoStudio(page);
  const imported = {
    preset: "bubble",
    font: "rounded",
    fontSize: 27,
    backgroundOpacity: 0.61,
    accent: "#ff3366",
    messageLifetime: 46,
    maxMessages: 17,
    animation: "fade",
    alignment: "right",
    direction: "top",
    showBadges: false,
    showTimestamps: true,
    showReplies: false,
    readableColors: true,
    hideCommands: false,
    showNotices: false,
    showFirstMessage: false,
    blockedUsers: ["nightbot"],
    blockedWords: ["spoiler"],
  };

  await page.locator('input[type="file"]').setInputFiles({
    name: "stream-layout.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ version: 1, settings: imported })),
  });

  await expect(page.getByRole("button", { name: "Bubble" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("slider", { name: /Text size/ })).toHaveValue(
    "27",
  );
  await expect(page.getByLabel(/Hidden users/)).toHaveValue("nightbot");
  await expect(
    page.getByRole("checkbox", { name: "Badges" }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Right aligned" }),
  ).toHaveAttribute("aria-pressed", "true");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("openstreamalert-bubble.json");
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(exported).toEqual({ version: 1, settings: imported });
});

test("user and phrase filters reject matching incoming preview messages", async ({
  page,
}) => {
  await openDemoStudio(page);
  await page.getByLabel(/Hidden users/).fill("@softserve");
  await page.getByLabel(/Hidden words/).fill("IMMACULATE");

  const messages = page.locator(".chat-message");
  await expect(messages).toHaveCount(3);
  await page.getByRole("button", { name: /Test message/ }).click();
  await expect(messages).toHaveCount(3);
  await page.getByRole("button", { name: /Test message/ }).click();
  await expect(messages).toHaveCount(4);
  await expect(messages.last()).toContainText("northstar");
  await page.getByRole("button", { name: /Test message/ }).click();
  await expect(messages).toHaveCount(4);
});

test("studio controls expose selection and keyboard focus state", async ({
  page,
}) => {
  await openDemoStudio(page);
  const glass = page.getByRole("button", { name: "Glass" });
  const terminal = page.getByRole("button", { name: "Terminal" });
  await expect(glass).toHaveAttribute("aria-pressed", "true");
  await terminal.click();
  await expect(glass).toHaveAttribute("aria-pressed", "false");
  await expect(terminal).toHaveAttribute("aria-pressed", "true");

  const timestamps = page.getByRole("checkbox", { name: "Timestamps" });
  await timestamps.focus();
  await expect(timestamps).toBeFocused();
  const focusOutline = await timestamps
    .locator("xpath=following-sibling::i")
    .evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(focusOutline).toBe("solid");
  await page.keyboard.press("Space");
  await expect(timestamps).toBeChecked();
});

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 1000 },
]) {
  test(`${viewport.name} studio remains ordered and viewport-safe`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await openDemoStudio(page);
    await testInfo.attach(`${viewport.name}-studio`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    const dimensions = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBe(dimensions.innerWidth);

    const controls = await page.locator(".controls").boundingBox();
    const preview = await page.locator(".preview-column").boundingBox();
    expect(controls).not.toBeNull();
    expect(preview).not.toBeNull();
    if (viewport.name === "mobile")
      expect(controls!.y).toBeLessThan(preview!.y);

    const previewViewport = await page
      .locator(".preview-viewport")
      .boundingBox();
    expect(previewViewport).not.toBeNull();
    expect(previewViewport!.width / previewViewport!.height).toBeCloseTo(
      5 / 7,
      2,
    );
    expect(previewViewport!.width).toBeLessThanOrEqual(500);
  });
}

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
