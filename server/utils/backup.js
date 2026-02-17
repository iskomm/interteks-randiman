const { exec } = require('child_process');

// Get current date and time for backup file naming
const currentDateTime = new Date().toISOString().replace(/[:]/g, '-');

// Name of the backup file
const backupFile = `backup-${currentDateTime}.sql`;

// Database credentials and configuration (modify as needed)
const dbUser = 'your_db_user';
const dbPassword = 'your_db_password';
const dbName = 'your_database_name';
const dbHost = 'localhost';

// Command to perform the database backup
const backupCommand = `mysqldump -u ${dbUser} -p${dbPassword} -h ${dbHost} ${dbName} > ${backupFile}`;

// Execute the backup command
exec(backupCommand, (error, stdout, stderr) => {
    if (error) {
        console.error(`Error executing backup: ${error.message}`);
        return;
    }
    if (stderr) {
        console.error(`Backup error: ${stderr}`);
        return;
    }
    console.log(`Backup successful! File saved as: ${backupFile}`);
});
