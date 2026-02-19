/*globals Gui rq rq_post numReplacer numP Album*/

class Img{
    constructor(j2){
        const meta = (j2 && j2[0]) ? j2[0] : [];
        this.id = meta[0] || null; // == imgkey
        this.name = meta[2] || null;
        this.modified = meta[3] || null;
        if(this.name){console.log(this.name);}
        if(this.id){console.log(this.id);}
    }
}


// eslint-disable-next-line no-unused-vars
class Sorter extends Gui{
    constructor(){
        super();
        this.al = null;
        this.settings = {};
        this.imgIdSet = {};
        this.albumImgIds = [];
        this.retryDelays = [500, 1000, 2000, 4000, 8000];
    }

    // Delay helper to give the API time to process
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    isValidImgId(id){
        return typeof id === 'string' && id.length > 10;
    }

    extractImgId(item){
        if(Array.isArray(item)){return item[0];}
        return item;
    }

    collectAlbumImgIds(imgs){
        let ids = [];
        let seen = {};
        for(let i = 0; i < imgs.length; i++){
            let id = this.extractImgId(imgs[i]);
            if(! this.isValidImgId(id)){continue;}
            if(seen[id]){continue;}
            seen[id] = true;
            ids.push(id);
        }
        return ids;
    }

    parseAuthTokens(src){
        if(! src){return null;}
        let sw = src.split('window.WIZ_global_data = ');
        if(sw.length < 2){return null;}
        let sww = sw[1].split(';')[0];
        let wizGlobalData = JSON.parse(sww);
        if(! wizGlobalData.FdrFJe || ! wizGlobalData.SNlM0e){
            return null;
        }
        return {
            f_sid: wizGlobalData.FdrFJe,
            at_: wizGlobalData.SNlM0e
        };
    }

    async refreshAuthTokens(){
        let src = await rq({
            url: `${this.al.url_f}${this.al.type}/${this.al.id}`,
            type: 'GET',
            dataType: 'text',
            timeout: 30000
        });
        let auth = null;
        try{
            auth = this.parseAuthTokens(src);
        }catch(e){
            console.log(e);
            auth = null;
        }
        if(! auth){return false;}
        this.al.f_sid = auth.f_sid;
        this.al.at_ = auth.at_;
        return true;
    }

    isBatchOk(res, rpcid){
        if(! res){return false;}
        if(res.indexOf('"wrb.fr","' + rpcid + '"') === -1){return false;}
        return true;
    }

    async postWithRetry(data, rpcid, delays){
        for(let i = 0; i < delays.length; i++){
            data.at = this.al.at_;
            this.settings.data = data;
            let res = await rq_post(this.settings);
            if(this.isBatchOk(res, rpcid)){
                return res;
            }
            if(i + 1 < delays.length){
                if(i % 2 === 1){
                    await this.refreshAuthTokens();
                }
                await this.sleep(delays[i]);
            }
        }
        return null;
    }

    async postUntilOk(data, rpcid, statusPrefix){
        let attempt = 0;
        while(true){
            attempt++;
            let res = await this.postWithRetry(data, rpcid, this.retryDelays);
            if(res){return res;}
            this.addName(`${statusPrefix} retry ${attempt}`);
            await this.refreshAuthTokens();
            await this.sleep(Math.min(10000, 500 * attempt));
        }
    }

    makeImgMap(){
        let imgMap = {};
        for(let i = 0; i < this.al.new_imgs.length; i++){
            let io = this.al.new_imgs[i];
            imgMap[io.id] = io;
        }
        return imgMap;
    }

    isSameOrder(a, b){
        if(! a || ! b){return false;}
        if(a.length !== b.length){return false;}
        for(let i = 0; i < a.length; i++){
            if(a[i] !== b[i]){return false;}
        }
        return true;
    }

    async getCurrentOrderIds(){
        let al = new Album();
        let success = await al.parseAlbum();
        if(! success){return null;}
        return this.collectAlbumImgIds(al.imgs);
    }

    makeImgInfosFreq(imgs){
        let imgInfosFreq = [];
        for(let i = 0; i < imgs.length; i++){
            let imgkey = this.extractImgId(imgs[i]);
            if(! this.isValidImgId(imgkey)){continue;}
            let j0 = [imgkey, 1];
            let j1 = [
                "fDcn4b", JSON.stringify(j0),
                null, (i + 1).toString()
            ];
            imgInfosFreq.push(j1);
        }
        return [imgInfosFreq];
    }

    addNewImgs(res){
        let added = 0;
        let infos = res.split(/\n\d+\n/);
        for(var i = 0; i < infos.length; i++){
            let info = infos[i];
            if(info.indexOf('"wrb.fr","fDcn4b"') == -1){
                continue;
            }
            let io;
            try{
                let j = JSON.parse(info);
                let j2 = JSON.parse(j[0][2]);
                io = new Img(j2);
            }catch(e){
                console.log(e);
                continue;
            }
            if(! this.isValidImgId(io.id)){continue;}
            if(typeof io.name !== 'string' || io.name.length === 0){continue;}
            if(this.imgIdSet[io.id]){
                continue;
            }
            this.imgIdSet[io.id] = true;
            this.al.new_imgs.push(io);
            this.addName(io.name);
            let den = this.albumImgIds.length || this.al.new_imgs.length;
            let per = (this.al.new_imgs.length / den) * 100;
            this.addPercent(per);
            added++;
        }
        return added;
    }

    async fetchImgInfosByIds(ids, byNum, label){
        this.settings = {
            url: this.al.makeUrl('fDcn4b'),
            type: 'POST',
            timeout: 30000,
            dataType: 'text' // res data type
        };
        for(let i = 0; i < ids.length; i = i + byNum){
            let batchIds = ids.slice(i, i + byNum);
            let imgInfosFreq = this.makeImgInfosFreq(batchIds);
            if(imgInfosFreq[0].length === 0){continue;}
            let res = await this.postUntilOk(
                {
                    'f.req': JSON.stringify(imgInfosFreq),
                    'at': this.al.at_
                },
                'fDcn4b',
                `${label} ${Math.min(i + byNum, ids.length)}/${ids.length}`
            );
            this.addNewImgs(res);
            await this.sleep(120);
        }
        return true;
    }

    async getImgInfos(){
        return this.fetchImgInfosByIds(this.albumImgIds, 50, 'Metadata');
    }

    getMissingImgIds(){
        let missing = [];
        for(let i = 0; i < this.albumImgIds.length; i++){
            let imgId = this.albumImgIds[i];
            if(! this.imgIdSet[imgId]){
                missing.push(imgId);
            }
        }
        return missing;
    }

    async recoverMissingOneByOne(missing){
        for(let i = 0; i < missing.length; i++){
            let id = missing[i];
            if(this.imgIdSet[id]){continue;}
            this.addName(`Recover one ${i + 1}/${missing.length}`);
            await this.fetchImgInfosByIds([id], 1, 'Single');
            await this.sleep(200);
        }
        return true;
    }

    async fillMissingImgInfos(){
        const byNums = [50, 20, 10, 5, 1];
        let stalledRounds = 0;
        let round = 0;
        while(true){
            let missing = this.getMissingImgIds();
            if(missing.length === 0){
                return true;
            }
            round++;
            let byNum = byNums[Math.min(stalledRounds, byNums.length - 1)];
            this.addName(`Filling ${missing.length} (round ${round})`);
            await this.fetchImgInfosByIds(missing, byNum, 'Fill');
            let after = this.getMissingImgIds().length;
            if(after === 0){
                return true;
            }
            if(after < missing.length){
                stalledRounds = 0;
                continue;
            }
            stalledRounds++;
            await this.refreshAuthTokens();
            if(stalledRounds >= 2){
                await this.recoverMissingOneByOne(missing);
            }
            if(stalledRounds >= 4){
                let refreshedIds = await this.getCurrentOrderIds();
                if(refreshedIds && refreshedIds.length > 0){
                    this.albumImgIds = refreshedIds;
                }
            }
            await this.sleep(Math.min(12000, 500 * (stalledRounds + 1)));
        }
    }

    sortBy(a, b){
        let an = a.name.toString().toLowerCase();
        let bn = b.name.toString().toLowerCase();
        an = an.replace(numP, numReplacer);
        // console.log('an: ' + an);
        bn = bn.replace(numP, numReplacer);
        // console.log('bn: ' + bn);
        if(an < bn){
            return -1;
        }else if(an > bn){
            return 1;
        }
        return 0;
    }

    makeSortFreq(baseImg, followImgs){
        let XXimg_keysXX = [];
        for (let i = 0; i < followImgs.length; i++) {
            let io = followImgs[i];
            XXimg_keysXX.push([[io.id]]);
        }
        var num = 3;
        // if(typ == 'share'){num = 3;}
        var j1 = [
            this.al.id,
            [],
            num,
            null,
            XXimg_keysXX, // Order after base
            [[baseImg.id]]// Base media
        ];
        return [
            [
                [
                    'QD9nKf',
                    JSON.stringify(j1),
                    null,
                    'generic'
                ]
            ]
        ];
    }

    async sortImgs(){
        this.settings = {
            url: this.al.makeUrl('QD9nKf'),
            type: 'POST',
            timeout: 30000,
            dataType: 'text' // res data type
        };

        this.al.new_imgs.sort(this.sortBy);
        const len = this.al.new_imgs.length;
        if(len <= 1){return true;}
        // Google API reliably moves about 10 images per batch
        const byNum = 10;
        let baseImg = this.al.new_imgs[0];
        await this.refreshAuthTokens();
        console.log('Sort start, first image:', baseImg.name);
        // Log first/last 10 to verify order
        console.log('Sorted first 10:', this.al.new_imgs.slice(0, 10).map(img => img.name));
        console.log('Sorted last 10:', this.al.new_imgs.slice(-10).map(img => img.name));
        // Start from the second item since the first is the anchor
        for(let i = 1; i < len; i = i + byNum){
            let end = Math.min(i + byNum, len);
            let followImgs = this.al.new_imgs.slice(i, end);
            let freq = this.makeSortFreq(baseImg, followImgs);
            let data = {
                'f.req': JSON.stringify(freq), 'at': this.al.at_
            };
            console.log(`Batch ${Math.ceil(i/byNum)}/${Math.ceil((len-1)/byNum)}: items ${i}-${end-1}, anchor: ${baseImg.name}, first: ${followImgs[0].name}, last: ${followImgs[followImgs.length-1].name}`);
            await this.postUntilOk(data, 'QD9nKf', `Sort ${end}/${len}`);
            this.progress('Sorted', end, len);
            // Next anchor is the last sorted item
            baseImg = followImgs[followImgs.length - 1];
            // Delay between batches so the API can process
            if(i + byNum < len) {
                await this.sleep(500);
            }
        }
        console.log('Sort success - all batches completed');
        return true;
    }

    async fixOrder(expectedIds){
        if(! expectedIds || expectedIds.length <= 1){return true;}
        this.settings = {
            url: this.al.makeUrl('QD9nKf'),
            type: 'POST',
            timeout: 30000,
            dataType: 'text' // res data type
        };
        let pass = 0;
        while(true){
            pass++;
            let currentIds = await this.getCurrentOrderIds();
            if(! currentIds || currentIds.length === 0){
                this.addName(`Read order retry ${pass}`);
                await this.sleep(Math.min(10000, 500 * pass));
                continue;
            }
            if(currentIds.length !== expectedIds.length){
                let currentSet = {};
                for(let i = 0; i < currentIds.length; i++){
                    currentSet[currentIds[i]] = true;
                }
                expectedIds = expectedIds.filter(id => currentSet[id]);
                let expectedSet = {};
                for(let i = 0; i < expectedIds.length; i++){
                    expectedSet[expectedIds[i]] = true;
                }
                currentIds = currentIds.filter(id => expectedSet[id]);
            }
            if(expectedIds.length <= 1){return true;}
            if(this.isSameOrder(expectedIds, currentIds)){
                return true;
            }

            let imgMap = this.makeImgMap();
            let baseImg = imgMap[expectedIds[0]];
            if(! baseImg){
                await this.fillMissingImgInfos();
                imgMap = this.makeImgMap();
                baseImg = imgMap[expectedIds[0]];
                if(! baseImg){
                    this.addName(`Fix map retry ${pass}`);
                    await this.sleep(Math.min(8000, 500 * pass));
                    continue;
                }
            }

            for(let i = 1; i < expectedIds.length; i++){
                let expectId = expectedIds[i];
                let followImg = imgMap[expectId];
                if(! followImg){
                    this.addName(`Missing map ${i + 1}/${expectedIds.length}`);
                    continue;
                }
                if(currentIds[i] === expectId){
                    baseImg = followImg;
                    continue;
                }
                let freq = this.makeSortFreq(baseImg, [followImg]);
                let data = {
                    'f.req': JSON.stringify(freq), 'at': this.al.at_
                };
                await this.postUntilOk(data, 'QD9nKf', `Fix ${i + 1}/${expectedIds.length}`);
                let fromIndex = currentIds.indexOf(expectId);
                if(fromIndex !== -1){
                    currentIds.splice(fromIndex, 1);
                }
                currentIds.splice(i, 0, expectId);
                baseImg = followImg;
                this.progress('Fixing', i + 1, expectedIds.length);
                await this.sleep(500);
            }

            let finalIds = await this.getCurrentOrderIds();
            if(finalIds && this.isSameOrder(expectedIds, finalIds)){
                return true;
            }
            this.addName(`Fix pass ${pass} retry`);
            await this.refreshAuthTokens();
            await this.sleep(Math.min(12000, 600 * pass));
        }
    }

    async run(){
        this.myspin();
        try{
            let parseTry = 0;
            while(true){
                this.al = new Album();
                let success = await this.al.parseAlbum();
                if(success){break;}
                parseTry++;
                this.addName(`Parse retry ${parseTry}`);
                await this.sleep(Math.min(10000, 500 * parseTry));
            }

            this.albumImgIds = this.collectAlbumImgIds(this.al.imgs);
            if(this.albumImgIds.length === 0){
                throw new Error('No valid image ids found in album');
            }
            this.addName(`Found ${this.albumImgIds.length} medias`);

            await this.getImgInfos();
            await this.fillMissingImgInfos();
            await this.sortImgs();
            let expectedIds = this.al.new_imgs.map(img => img.id);
            await this.fixOrder(expectedIds);
            this.reload(this.al);
        }catch(e){
            this.onerr(e);
        }finally{
            this.buttonEnable();
            this.mystop();
        }
    }
    // Sometimes the album itself is broken
    // The only fix is to move all images to a new album
}
