# Feedback endpoint

`feedback.html` posts `name` and `message` to a Google Apps Script web app, which appends them to a `Feedback` tab in its spreadsheet.

1. Open the destination spreadsheet and choose **Extensions > Apps Script**.
2. Replace the starter script with `tools/feedback-apps-script.gs` and save it.
3. Choose **Deploy > New deployment > Web app**.
4. Set **Execute as** to **Me** and **Who has access** to **Anyone**, then authorize the deployment.
5. Put the resulting `/exec` URL in `FORM_ACTION` in `scripts/feedback.js`.

After changing the Apps Script, create a new deployment version under **Deploy > Manage deployments**; otherwise the previous version remains active.
