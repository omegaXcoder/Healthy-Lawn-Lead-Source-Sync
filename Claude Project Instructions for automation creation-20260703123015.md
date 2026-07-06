# Claude Project Instructions for automation creation

## General Instructions
Whenever creating an automation on top of creating a method for automating the process make sure to consider building in ways to locally run a dry run first that logs what would have happened and any errors it ran into in a log that is sent to me [omega@kudos.marketing](mailto:omega@kudos.marketing). Please have the subject line include "AUTOMATION LOGGING" so I can have my filter pick it up and automatically move it into a specific folder in my email

Always create a .readme file that includes all the different commands you can use wit the program (like running dry runs, headless, etc..)

### **Never trust** `.first` **on a broad text/class match without checking visibility**
Sites frequently have multiple elements that match the same text or class (hidden duplicates, off-screen templates, unrelated icons sharing a class). `.first` silently grabs whichever comes first in HTML order, which is not necessarily the one the user sees on screen. Default pattern for ambiguous selectors:
\`\`\`pythoncandidates = page.locator('your-selector')target = Nonefor i in range(candidates.count()): c = candidates.nth(i) if c.is\_visible(): target = c break\`\`\`Only fall back to a plain \`.first\` once a selector is confirmed unique via real inspection.

### **Every failure path must log AND screenshot — no silent \`return False**
Any function that can fail (element not found, click didn't register, timeout) must log a specific warning/error message AND take a debug screenshot at the point of failure, before returning a failure value. Also I will want to have a result log sent to [omega@kudos.marketing](mailto:omega@kudos.marketing)

### **Validate config/mapping data against the real system, not just internal consistency**
When matching free-text values (e.g. a dropdown's exact label) against a config file, expect spelling/formatting mismatches between what's documented and what the live system actually contains. Treat a "no match found" error as a data problem to verify against the real UI, not necessarily a code bug. Point these out to be reviewed in case the config file needs to be updated.

### **Headless CI environments are NOT identical to local headed runs**
Code that works reliably on a local machine can fail under GitHub Actions or other CI runners due to slower rendering, different timing, or stricter artifact rules (e.g. GitHub Actions rejects certain characters like \`|\` in uploaded file paths). Sanitize any dynamically-generated filenames, and favor generous explicit waits over fixed short timeouts for anything that worked "fast enough" locally.
# Logging In To Service Autopilot
Here are the selectors and information for logging in to a service autopilot account
### Login URL
Login URL: [https://my.serviceautopilot.com/](https://my.serviceautopilot.com/)
### Selector for Username:
<input name="txtLogin" type="text" id="txtLogin" placeholder="Email" class="inputField">
### Selector for Password:
<input name="txtPassword" type="password" id="txtPassword" placeholder="Password" class="inputField">
## Selector for Login Button
<button id="loginbtn" style="width: 100px; height: 40px; font-size: 13px; font-weight: bold;" onclick="onLogin(); return false;"> Log In</button>