# ContextFlow — Fix & Re-deploy Plan

## Steps
- [x] 1. Fix Vercel file-upload crash: switch multer to memoryStorage in server.js
- [x] 2. Rename all "Talking Rabbitt" / "rabbitt" references to "ContextFlow"
   - [x] package.json (name + description)
   - [x] server.js (health msg, prompt, console.log, upload buffer)
   - [x] public/app.js (comment + footer text)
   - [x] public/styles.css (comment)
   - [x] TODO.md
   - [x] Bhavya.md
   - [x] README.md
- [x] 3. Add file-size limit + centralized error handler for clean JSON upload errors
- [x] 4. Validate Gemini API key against Google during configuration
- [x] 5. Make frontend gracefully handle non-JSON responses (413 "Request Entity Too Large")
- [ ] 6. Test locally with node server.js
- [ ] 7. Re-deploy to Vercel (`vercel --prod`)
