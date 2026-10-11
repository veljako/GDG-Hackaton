// Select through the actual custom menu; editing forms still use native selects.
export async function chooseFilter(page, label, value) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page
    .getByRole("listbox", { name: label, exact: true })
    .locator(`[role="option"][data-value="${value}"]`)
    .click();
}
