import child_process from 'child_process';
export default function runBashCommand(command, args = []) {
    return new Promise((resolve, reject) => {
        const bash = child_process.spawn(command, args, { shell: true });
        let stdout = '';
        let stderr = '';

        bash.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        bash.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        bash.on('close', (code) => {
            resolve({
                code,
                stdout,
                stderr
            });
        });
    });
}