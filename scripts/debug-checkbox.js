const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));

  try {
    // Navigate to login
    await page.goto('http://localhost:3000/login');
    await page.fill('input[placeholder="Tài khoản"]', 'toandv');
    await page.fill('input[type="password"]', '123456');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);

    // Get the task directly (need task ID - getting from list)
    await page.goto('http://localhost:3000/dashboard/tasks');
    await page.waitForTimeout(2000);
    
    // Find P1.1B for TEST-AUTO-03 and click
    const taskLinks = page.locator('text="BGĐ phê duyệt triển khai"');
    if (await taskLinks.count() > 0) {
      await taskLinks.first().click();
      await page.waitForTimeout(3000); // Wait for details to load

      // Check the state of the debug banner
      const debugText = await page.locator('div:has-text("DEBUG - isActive")').last().textContent();
      console.log('DEBUG BANNER:', debugText);

      // Find the first checkbox
      const checkbox = page.locator('input[type="checkbox"]').first();
      
      const beforeChecked = await checkbox.isChecked();
      const disabled = await checkbox.isDisabled();
      console.log('CHECKBOX BEFORE:', { checked: beforeChecked, disabled });

      // Click it directly using JS
      await checkbox.evaluate(el => el.click());
      await page.waitForTimeout(1000);
      
      const afterChecked = await checkbox.isChecked();
      console.log('CHECKBOX AFTER JS CLICK:', { checked: afterChecked });

      // Click it using playwright
      await checkbox.click({ force: true });
      await page.waitForTimeout(1000);

      const finalChecked = await checkbox.isChecked();
      console.log('CHECKBOX AFTER PW CLICK:', { checked: finalChecked });
    } else {
      console.log('Could not find P1.1B task in list');
    }
  } catch (err) {
    console.error('Test failed:', err);
  } finally {
    await browser.close();
  }
})();
