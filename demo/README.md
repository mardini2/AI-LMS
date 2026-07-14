# SECU74000 Demo Moodle Course

This folder contains the Moodle backup used for the AI-LMS capstone demonstration.

## Course Information

- Course Name: Rootkits and Hacking
- Course Code: SECU74000
- Backup File: `SECU74000-Rootkits-and-Hacking-Demo.mbz`

The course includes:

- Course Information
- Weekly announcements
- Weekly overview pages
- Lecture PDFs
- Assignments
- Midterm information
- Final project
- Final exam topics

Large ISO/ZIP lab files are intentionally **not included** in the backup.

---

# Restoring the Course

1. Start the Moodle Docker environment.
2. Log in as an administrator.
3. Navigate to:

```
Course → More → Course reuse → Restore
```

or

```
Site administration → Courses → Restore course
```

4. Upload:

```
SECU74000-Rootkits-and-Hacking-Demo.mbz
```

5. Restore the course as a **new course**.

6. Do **not** restore:
   - User data
   - Enrolled users
   - Grades
   - Logs

7. Once the course has been restored, run the AI-LMS ingestion process so the chatbot indexes the course content.

---

# Notes

- This backup contains only course content.
- Student submissions and grades are not included.
- The backup is intended for local development and demonstrations.
- Large laboratory ISO/ZIP files are excluded because they significantly increase the backup size and are not required for demonstrating the AI-LMS chatbot. The lecture material, announcements, pages, assignments, and supporting documents provide sufficient content for indexing and retrieval.