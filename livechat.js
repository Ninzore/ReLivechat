import fs from "fs-extra"
import axios from "axios";

axios.defaults.__retry = 2;
let retry_delay = 500;

axios.interceptors.response.use(undefined, err => {
    const status = err.response ? err.response.status : null;
    const config = err.config;
    console.log(`Error code ${status}, retry times = ${config.__retry}`)
    if (!config || config.__retry <= 0) return Promise.reject(err);

    config.__retry --;
    return new Promise(resolve => {
        setTimeout(resolve, retry_delay);
    }).then(() => {
        return axios(config);
    });
});

async function getInfo(id) {
    let webpage = await axios.get(`https://www.youtube.com/watch?v=${id}`);
    try {
        let continuation = /(?:window\s*\[\s*["\']ytInitialData["\']\s*\]|ytInitialData)\s*=\s*({.+?})\s*;/.exec(webpage.data)[1];

        continuation = JSON.parse(continuation).contents.twoColumnWatchNextResults
            .conversationBar.liveChatRenderer.header.liveChatHeaderRenderer
            .viewSelector.sortFilterSubMenuRenderer.subMenuItems[1]
            .continuation.reloadContinuationData.continuation;
    
        return continuation;
    }
    catch(err) {
        console.error("Maybe the live comments are disable for this content");
        return false;
    }
}

async function getContinuation(continuation) {
    try {
        let res = await axios.get("https://www.youtube.com/live_chat_replay/get_live_chat_replay", {
            headers : {
                "User-Agent" : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36,gzip(gfe)",
            },
            params : {
                "continuation" : continuation,
                "pbj" : 1,
                "hidden" : false,
                "playerOffsetMs" : 0
            }
        }).catch(err => {
            console.error(err);
            throw new Error("Connection Error");
        });
        if ("continuationContents" in res.data.response) {
            return res.data.response.continuationContents.liveChatContinuation;
        }
        else throw new Error("No continuation");
    }
    catch(err) {
        console.error(err);
    }
}

function actionsProcess(actions) {
    let chatlog = [];
    for (let action of actions) {
        let act = action.replayChatItemAction.actions[0];
        if (act.addChatItemAction == undefined) continue;
        if (!"item" in act.addChatItemAction) continue;

        let item = act.addChatItemAction.item;
        let renderer = item.liveChatPaidMessageRenderer
            || item.liveChatTextMessageRenderer || false;
        if (! renderer || !"authorName" in renderer) continue;

        const template = {
            id : "",
            author : {
                name : "",
                channelId : "",
                badge : ""
            },
            message : "",
            superchat : {
                isSuperchat : false,
                amount : "0",
            },
            offset : 0,
            timestampText : "",
            timestampUsec : "0",
        }

        template.id = renderer.id;
        template.author.name = renderer.authorName.simpleText;
        template.author.channelId = renderer.authorExternalChannelId;
        template.author.badge = "authorBadges" in renderer ?
            renderer.authorBadges[0].liveChatAuthorBadgeRenderer.tooltip : "";
        
        if ("purchaseAmountText" in renderer) {
            template.superchat.isSuperchat = true;
            template.superchat.amount = renderer.purchaseAmountText.simpleText;
        }

        template.timestampText = renderer.timestampText.simpleText;
        template.timestampUsec = renderer.timestampUsec;
        template.offset = parseInt(action.replayChatItemAction.videoOffsetTimeMsec);

        if (renderer.message == undefined) template.message = "";
        else {
            let message = [];
            for (let run of renderer.message.runs) {
                if ("text" in run) message.push(run.text);
                else if ("emoji" in run) message.push(run.emoji.shortcuts[0]);
                else console.error("Unknown message:", run);
            }
            template.message = message.join(" ");
        }
        
        chatlog.push(template);
    }
    return chatlog;
}

async function singleRun(continuation) {
    let {continuations, actions} = await getContinuation(continuation);
    if (!continuations) return false;

    let continuation_data = continuations[0].liveChatReplayContinuationData || false;
    continuation = continuation_data.continuation || false;

    if (!continuation || !Array.isArray(actions)) {
        throw "Stream Ends";
    }
    let chatlog = actionsProcess(actions);

    let waitMs = "timeoutMs" in continuation_data ? 
        continuation_data.timeoutMs : 100;
    await new Promise (resolve => {
        setTimeout(resolve, waitMs);
    });

    return {chatlog, continuation};
}
async function loop(continuation, id) {
    let chatlogs = [];
    try {
        while (1) {
            let chatlog = [];
            ({chatlog, continuation} = await singleRun(continuation));
            chatlogs.push(...chatlog);
            process.stdout.write(`\rCurrent Prograss: ${chatlog[chatlog.length - 1].timestampText}`);
            if (!continuation) throw new Error("No continuation");
        }
        return;
    }
    catch(err) {
        if (err == "No continuation") {
            console.log("No more continuations, stream ends");
            console.log("last continuation = ", continuation);
        }
        else if (err == "Stream Ends") {
            console.log("Stream Ends, all done");
        }
        else console.error(err);
    }
    finally {
        console.log(`Saving to ${id}.json`);
        fs.writeJSONSync(`./data/${id}.json`, chatlogs);
    }
}

async function startSync(id) {
    let continuation = await getInfo(id);
    if (continuation) loop(continuation, id);
    else console.error("Initialization ERROR, exit");
}

// change the record id here
// startSync("Ec4Qs_GzA0k")