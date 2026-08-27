# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## NU Baliwag student registry activation

Students do not self-register. An administrator imports the Registrar-approved student list from **Admin → Manage Users** using the downloadable Excel workbook (`.xlsx`) or a compatible CSV export. Duplicate student numbers or emails inside one file are rejected. For existing registry entries, unchanged rows are skipped and changed rows are updated; only genuinely new students are inserted. The live application reads the resulting `nub_student_registry` table through the server-only `/api/nub-student-auth` endpoint.

Before using the flow:

1. Apply `supabase/migrations/20260827120000_add_nub_student_registry_and_login.sql` and `supabase/migrations/20260827130000_expand_nub_registry_and_enrollment_status.sql` after the earlier NUB academic migrations.
2. Set `SUPABASE_SERVICE_ROLE_KEY` only in the API/server environment; use `.env.example` as the configuration template.
3. Disable unrestricted public email sign-ups in Supabase Auth. Student auth users must be provisioned by the registry endpoint.
4. Configure the Supabase Magic Link email template to display `{{ .Token }}` so `signInWithOtp` sends a code the login screen can accept, rather than only a clickable magic link.
5. Download the Excel registry template from Manage Users, enter one student per row, and import the completed `.xlsx` workbook. The CSV alternative uses the same columns.

The registry stores the student's official name, contact details, address, school, course, class section, year level, and `school_status`. Accepted school statuses are `Enrolled`, `Dropped`, and `Graduated`; only `Enrolled` records can activate or access the student application.

On first login, an enrolled student enters their `@students.nu-baliwag.edu.ph` email, verifies the OTP sent to that inbox, accepts the terms, and creates an application password. Later logins use the institutional email and that password. Registry identity and academic details remain administrator-managed. There is no student ID upload, OCR check, public sign-up form, or separate admin identity approval step.

For local testing with unavailable institutional inboxes, set both `ENABLE_DEV_STUDENT_OTP_BYPASS=true` and `REACT_APP_ENABLE_DEV_STUDENT_OTP_BYPASS=true`, restart `npm start`, and use `000000` during first-time activation. This shortcut is rejected unless the server is running in development on localhost and the registry record is Enrolled. Never enable these flags in a deployed environment.

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)
