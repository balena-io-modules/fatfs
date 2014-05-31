var type = process.argv[2],
    uniq = Math.random().toString(36).slice(2),
    IMG = require('os').tmpdir()+"fatfs-test-"+uniq+".img";
if (!type) throw "Usage: node test [FAT12|FAT16|FAT32|ExFAT|…]";

if (type[0] === '/') startTests(type);
else require('child_process').exec("./make_sample.sh "+JSON.stringify(IMG)+" "+JSON.stringify(type), function (e,out,err) {
    if (e) throw e;
    console.warn(err.toString());
    //console.log(out.toString());
    startTests(IMG);
    require('fs').unlink(IMG, function (e) {
        if (e) console.warn("Error cleaning up test image", e);
    });
});

function startTests(imagePath) {
    var fatfs = require("./index.js"),
        vol = require("./img_volume.js").createDriverSync(imagePath),
        fs = fatfs.createFileSystem(vol);
setTimeout(function () {            // HACK: should wait for 'ready' event or something (not implemented)

    var BASE_DIR = "/fat_test",
        FILENAME = "Simple File.txt",
        TEXTDATA = "Hello world!";
    
    fs.readdir("/", function (e,files) {
        assert(!e, "No error reading root directory.");
        assert(Array.isArray(files), "Got a list of files: "+files);
    });
    
    fs.mkdir(BASE_DIR, function (e) {
        assert(!e, "No error from fs.mkdir");
        fs.readdir(BASE_DIR, function (e,arr) {
if (e) console.log(e.stack);
            assert(!e, "No error from fs.readdir");
            assert(arr.length === 0 , "No files in BASE_DIR yet.");
        });
        var file = [BASE_DIR,FILENAME].join('/');
        fs.writeFile(file, TEXTDATA, function (e) {
            assert(!e, "No error from fs.writeFile");
            startStreamTests();
            fs.readdir(BASE_DIR, function (e, arr) {
                assert(!e, "Still no error from fs.readdir");
                assert(arr.length === 2, "Test directory contains two files.");     // (ours + startStreamTests's)
                assert(arr[0] === FILENAME, "Filename is correct.");
                
                fs.stat(file, function (e,d) {
                    assert(!e, "No error from fs.stat");
                    assert(d.isFile() === true, "Result is a file…");
                    assert(d.isDirectory() === false, "…and not a directory.");
                    assert(d.size === Buffer.byteLength(TEXTDATA), "Size matches length of content written.");
                });
                fs.readFile(file, {encoding:'utf8'}, function (e, d) {
                    assert(!e, "No error from fs.readFile");
                    assert(d === TEXTDATA, "Data matches what was written.");
                });
                // now, overwrite the same file and make sure that goes well too
                fs.writeFile(file, Buffer([0x42]), function (e) {
                    assert(!e, "Still no error from fs.writeFile");
                    fs.readdir(BASE_DIR, function (e, arr) {
                        assert(!e, "No error from fs.readdir");
                        assert(arr.length === 2, "Test directory still contains two files.");
                        assert(arr[0] === FILENAME, "Filename still correct.");
                        fs.stat(file, function (e,d) {
                            assert(!e, "Still no error from fs.stat");
                            assert(d.isFile() === true, "Result is still a file…");
                            assert(d.isDirectory() === false, "…and not a directory.");
                            assert(d.size === 1, "Size matches length of now-truncated content.");
                        });
                        fs.readFile(file, function (e, d) {
                            assert(!e, "Still no error from fs.readFile");
                            assert(Buffer.isBuffer(d), "Result without encoding is a buffer.");
                            assert(d.length === 1, "Buffer is correct size.");
                            assert(d[0] === 0x42, "Buffer content is correct.");
                        });
                    });
                });
            });
        });
        
        function startStreamTests() {
            var file2 = [BASE_DIR,FILENAME+"2"].join('/'),
                outStream = fs.createWriteStream(file2);
            var outStreamOpened = false;
            outStream.on('open', function () {
                outStreamOpened = true;
            });
            setTimeout(function () {
                assert(outStreamOpened, "outStream fired 'open' event in a timely fashion.");
            }, 1e3);
            var TEXT_MOD = TEXTDATA.toLowerCase()+"\n";
            outStream.write(TEXT_MOD, 'utf16le');
            outStream.write("Ο καλύτερος χρόνος να φυτευτεί ένα \ud83c\udf31 είναι δέκα έτη πριν.", 'utf16le');
            outStream.write("La vez del segundo mejor ahora está.\n", 'utf16le');
            for (var i = 0; i < 1024; ++i) outStream.write("123456789\n", 'ascii');
            outStream.write("JavaScript how do they work\n", 'utf16le');
            outStream.write("The end, almost.\n", 'utf16le');
            outStream.end(TEXTDATA, 'utf16le');
            var outStreamFinished = false;
            outStream.on('finish', function () {
                outStreamFinished = true;
                
                var inStream = fs.createReadStream(file2, {start:10240, encoding:'utf16le', autoClose:false}),
                    gotData = false, gotEOF = false, inStreamFD = null;
                inStream.on('open', function (fd) {
                    assert(fd, "Got file descriptor");
                    inStreamFD = fd;
                });
                inStream.on('data', function (d) {
                    gotData = true;
                    assert(typeof d === 'string', "Data returned as string.");
console.log("orig:", JSON.stringify(d));            // aha! it's returning content past the end of the file…
console.log("chop:", d.slice(-TEXTDATA.length), -TEXTDATA.length, d.length);
console.log("want:", TEXTDATA);
                    assert(d.slice(-TEXTDATA.length) === TEXTDATA, "End of file matches what was written.");
                });
                inStream.on('end', function () {
                    gotEOF = true;
                    
                    var len = Buffer.byteLength(TEXT_MOD, 'utf16le'),
                        buf = new Buffer(len);
                    fs.read(inStreamFD, buf, 0, len, 0, function (e,n,d) {
                        assert(!e, "No error reading from beginning of inStream's file descriptor.");
                        assert(n === len, "Read complete buffer at beginning of inStream's fd.");
                        assert(d.toString('utf16le') === TEXT_MOD, "Data matches at beginning of inStream's fd.");
                        fs.close(inStreamFD, function (e) {
                            assert(!e, "No error closing inStream's fd.");
                        });
                    });
                });
                setTimeout(function () {
                    assert(gotData, "inStream fired 'data' event in a timely fashion.");
                    setTimeout(function () {
                        assert(gotEOF, "inStream fired 'eof' event in a timely fashion.");
                    }, 1e3);
                }, 1e3);
            });
            setTimeout(function () {
                assert(outStreamFinished, "outStream fired 'finish' event in a timely fashion.");
            }, 5e3);
        }
    });

}, 1e3);
}



function assert(b,msg) { if (!b) throw Error("Assertion failure. "+msg); else console.log(msg); }


