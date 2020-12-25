import fs from "fs-extra";
import http from "http";

async function loadChatlog(id) {
    return fs.readJSON(`./data/${id}.json`);
}

function toTimeText(mSec) {
    let time = [];
    let ms = mSec % 1000;
    mSec = (mSec - ms) / 1000;
    let secs = mSec % 60;
    mSec = (mSec - secs) / 60;
    let mins = mSec % 60;
    let hrs = (mSec - mins) / 60;
    time.push(hrs, mins, secs);
    
    return time.join(":");
}

function percentile(sorted, percentage) {
    let pos = Math.ceil(sorted.length * percentage);
    return pos % 2 == 0 ? 
        (sorted[pos] + sorted[pos - 1]) / 2 : sorted[pos - 1];
}

function box(container, granularity) {
    let counter = container.counter;
    let mean = Math.round(container.total / counter.length);
    let sorted = [...counter].sort((a, b) => a - b);
    
    let median = percentile(sorted, 0.5);
    let q1 = percentile(sorted, 0.25);
    let q3 = percentile(sorted, 0.75);
    let iqr = q3 - q1;
    let max = Math.floor(q3 + 1.5 * iqr);
    let min = Math.floor(q1 - 1.5 * iqr);
    min = min < 0 ? 0 : min;

    let over_max = potential(counter, max, granularity);
    let over_q3 = potential(counter, q3, granularity);

    let need = {mean, min, q1, median, q3, max, over_q3, over_max};
    for (let stat of Object.keys(need)) {
        container[stat] = need[stat]
    }

    delete container.count;
    return container;
}

function potential(counter, margin, granularity) {
    let offset = 0;
    let clips = [];
    for (let count of counter) {
        if (count > margin) {
            clips.push({
                offset,
                time : toTimeText(offset),
                count
            });
        }
        offset += granularity;
    }

    return clips;
}

async function start(id) {
    let chatlog = await loadChatlog(id);
    
    const granularity = 300 * 1000;
    const word_search = ["", "草", "w"];
    let next_offset = granularity;
    let counters = [];
    let time = [];
    let reg = [];

    for (let i in word_search) {
        reg.push(new RegExp(word_search[i], "i"));
        if (!word_search[i]) word_search[i] = "__all";
        counters[i] = {
            word : word_search[i],
            count : 0,
            counter : [],
            total: 0
        };
    }

    for (let i in chatlog) {
        let chat = chatlog[i];
        for (let j in word_search) {
            if (word_search[j] == "__all") {
                counters[j].count ++;
                counters[j].total ++;
            }
            else if (reg[j].test(chat.message)) {
                counters[j].count ++;
                counters[j].total ++;
            }
        }

        if (chat.offset >= next_offset || i == chatlog.length - 1) {
            for (let j in counters) {
                counters[j].count ++;
                counters[j].counter.push(counters[j].count);
                counters[j].count = 0;
            }
            time.push(toTimeText(next_offset));
            next_offset += granularity;
        }
    }

    for (let i in counters) {
        box(counters[i], granularity)
    }

    let stats = {
        "start" : 0,
        "end" : chatlog[chatlog.length - 1].offset,
        time,
        counters
    }

    fs.writeJSONSync(`./stats/${id}_stats.json`, stats);
    server(stats)
}

function server(stats) {
    const hostname = '127.0.0.1';
    const port = 3000;
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
      };
    http.createServer((req, res) => {
        res.statusCode = 200;
        res.writeHead(200, headers);

        let param = new URL(req.url).search("stat");
        console.log(param)
        res.end(JSON.stringify(stats));
    }).listen(port, hostname, () => {
        console.log(`Server running at http://${hostname}:${port}/`);
    });
}

// change the rocord id here
// start("Ec4Qs_GzA0k")