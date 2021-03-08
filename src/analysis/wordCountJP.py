import re
import ujson as json
import fugashi
import neologdn
import argparse
from os import path
from datetime import datetime


custom_dict = False
custom_dict_path = ""   # the path to MeCab directory
raw_file_path = ""  # the path to livechat raw json files' directory
mecabrc_path = "/dev/null"  # MeCab's mecabrc file, delete this if on Windows
tagger = None

if custom_dict:
    cmd = ""
    if len(mecabrc_path) > 0:
        cmd = "-r {} -d '{}'".format(mecabrc_path, custom_dict_path)
    else:
        cmd = "-d '{}'".format(mecabrc_path, custom_dict_path)
    tagger = fugashi.GenericTagger(cmd)
else:
    tagger = fugashi.Tagger()

def loader(file):
    with open (file, 'r', encoding='utf-8') as f:
        data = json.load(f)
        f.close()
        return data


def counter(text):
    emoji_ptrn = re.compile(r":_[a-zA-Z]+(.+?):")
    noun_ptrn = re.compile("名詞")
    skip_ptrn = re.compile(r"^[a-zA-Z]+$")

    text = re.sub(emoji_ptrn, r"", text)
    text = neologdn.normalize(text, repeat = 1)
    cutted = tagger.parse(text)
    if custom_dict:
        cutted = cutted.rstrip().split("\t")
    cutted = tagger.parseToNodeList(text)
    
    if len(cutted) < 1:
        return {}

    current_index = {}

    for word in cutted:
        if re.match(skip_ptrn, word.surface):
            continue

        if custom_dict == True:            
            if not word.feature[0] == "名詞":
                continue
            
            word = word.surface
            if word == "(" or word == ")":
                continue

            if word not in current_index:
                current_index[word] = 1
            else:
                continue
        else:
            if not re.match(noun_ptrn, word.pos):
                continue
            
            word = word.surface
            
            if word not in current_index:
                current_index[word] = 1
            else:
                continue
    
    return current_index


def segProcess(raw_segment):
    word_index = {}
    for chat in raw_segment:
        message = chat["message"]
        current_index = counter(message)
        # count words' frequency
        for word in current_index:
            if word not in word_index:
                word_index[word] = 1
            else:
                word_index[word] += 1

    ranking = sorted(word_index.items(), key = lambda word: word[1], reverse=True)
    return ranking[0:5]

def ts2Text(ts):
    time = datetime.fromtimestamp(ts/1000.0)
    return "{:02d}:{:02d}:{:02d}".format(time.hour, time.minute, time.second)

def segmentation(raw, window):
    result = []
    batch = []
    i = 1
    for chat in raw:
        low_boundary = window * (i - 1)
        up_boundary = window * i

        if low_boundary <= chat["offset"] < up_boundary:
            batch.append(chat)
        else:
            ts_text = "{} ~ {}".format(ts2Text(low_boundary), ts2Text(up_boundary))

            result.append({"window": ts_text, "rank": segProcess(batch)})
            i += 1
            batch.clear()
    return result

def entry(id, window = 60):
    if window < 0.5:
        return False
    raw_file = path.join(raw_file_path, "{}.json".format(id))
    raw = loader(raw_file)
    result = segmentation(raw, window * 1000 * 60)
    print(json.dumps(result))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description = "pass -id and --seg-len to count comments")
    parser.add_argument("-id")
    parser.add_argument("-window", type = float, default = 1)
    args = parser.parse_args()
    entry(args.id, args.window)