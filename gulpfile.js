/**
 * @author wzf
 * @deta  2019-03-03
 * @email 373712195@qq.com
 */
const gulp = require('gulp');
const path = require('path');
const fsp = require('fs-promise');

const WX_DIR_PATH = path.join(__dirname,'wx/wcjs_wx_miniprogram')
const PAGES_PATH = path.join(WX_DIR_PATH,'/pages')

// 查找不使用的 class
// 1· gulp 命令行中传入页面文件参数   
// 2· gulp 从中查找对应的WXML 和 WXSS
// 3· WXSS 引用的 WXSS 查找 对应的 WXML元素 包括引用到的模版 
// 4· 生成 HTML 页面 鼠标指定的地方会出来对应使用到的WXML元素

// 难点 - 根据CSS选择器规则去查找哪些元素使用到了
//     - 可能页面直接修改了模版的CSS 这种查找可能会比较麻烦
//     - 要注意有些CSS是用来动态渲染的 
//     - 一些JS渲染的CSS变量 这个似乎查找有些困难

// 2019-3-05 注意
// 元素从到内到外查找 如果是常用标签则选择它的父级 class元素
// Wmxl因该不能直接存标签字符串作为key 以免遇到相同的情况 会被覆盖

// 2019-3-06 待做
// 标签选择器 处理
// _findNodeParent函数内部 区分id和class
// 完成后生成HTML


// 2019-3-23
// 选择器处理进度
// element	p	选择所有 <p> 元素。	1 《处理》
// element,element	div,p	选择所有 <div> 元素和所有 <p> 元素。	1  逗号分割的当作多个选择器处理
// element element	div p	选择 <div> 元素内部的所有 <p> 元素。	1 《处理》
// element>element	div>p	选择父元素为 <div> 元素的所有 <p> 元素。	2
// element+element	div+p	选择紧接在 <div> 元素之后的所有 <p> 元素。	2
// 要注意 @supper @miade @keyfame 可能拼错了 -。- 的写法处理
// 插件使用方法 参考 uncss
// 注意模版中的模版的是否可以处理 
// js 动态渲染的class 或者 id 要特殊处理
// 插件最后 记得写上测试用例
// 不对注释节点处理 OK
// 样式选择器对应的Wxml片段 用于完成后生成HTML使用

// 2019-3-24
// 优化 异步报错机制
// selectNode 问题

// 2019-3-25
// 把未匹配的选择器存储起来 下次遇到类似的选择器不用再去重复查找

const selectMap = {};
// 伪元素伪类匹配正则表达式
const pseudoClassReg = /\:link|\:visited|\:active|\:hover|\:focus|\:before|\:\:before|\:after|\:\:after|\:first-letter|\:first-line|\:first-child|\:lang\(.*\)|\:lang|\:first-of-type|\:last-of-type|\:only-child|:nth-last-child\(.*\)|\:nth-of-type\(.*\)|\:nth-last-of-type\(.*\)|\:last-child|\:root|\:empty|\:target|\:enabled|\:disabled|\:checked|\:not\(.*\)|\:\:selection/g;
//是否有同级选择器正则表达式 如： .a.b .a#b 
const peerSelectReg = /(?=\.)|(?=\#)/g;

/**
 * '/addtoptics' 
 * '/all_column' 检查完毕 没有问题
 * '/assistant'  检查完毕 没有问题
 * '/authorization' 检查完毕 没有问题
 */
const PAGE_DIR_PATH = '/brands'

gulp.task('one',async function(){
    const pageFilePath = path.join( PAGES_PATH, PAGE_DIR_PATH );
    const pageFiles = await fsp.readdir( pageFilePath, 'utf-8' )
    
    let pageWxss = await fsp.readFile( path.join( pageFilePath,pageFiles.find(v=>/\.wxss/.test(v)) ) ,'utf-8' );
    let pageWxml = await fsp.readFile( path.join( pageFilePath,pageFiles.find(v=>/\.wxml/.test(v)) ), 'utf-8' );

    // 获取Wxss中的选择器
    const classSelects = [];
    // 获取clss id 标签选择器
    pageWxss.replace(/([\.|\#|\w+].*)\{/g,($1,$2)=>{
        classSelects.push($2);
    })
    
    //获取Wxml树
    const { WxmlTree,selectNodeCache } = await getWxmlTree(pageWxml);

    //检查同级元素
    const _checkHasSelect = (select) => {
        const peerSelect = select.split( peerSelectReg )
        // peerSelect 大于 1 则为拥有同级选择器 如：.a.b
        if( peerSelect.length > 1 ){
            // 判断同级的第一个选择器在页面中有没有元素使用
            if( selectNodeCache[peerSelect[0]] ){
                const otherPeerSelects = peerSelect.slice(1,peerSelect.length);
                // 匹配到的元素 推入这个数组
                let matchNodes = selectNodeCache[peerSelect[0]].concat();
                return matchNodes = matchNodes.filter(node=>{
                    return otherPeerSelects.some(select=>{
                        // 如果是class
                        if( select[0] == '.' ){
                           return node.class.indexOf(select.slice(1)) != -1
                        // 如果是id
                        }else if( select[0] == '#' ){
                           return node.id == select
                        // 如果是标签
                        }else{
                           return _findNodeHasTag(node,select)
                        }
                    }) 
                })
            }else{
                return null;
            }
        }else{
            return selectNodeCache[peerSelect[0]] ? selectNodeCache[peerSelect[0]] : null;
        }
    }

    //寻找子元素的父级元素
    const _findNodeParent = (node,select) => {
        // 已经到达root节点 寻找不到节点
        if( node.parent.key == 'root' ) return null;

        const peerSelect =  select.split(peerSelectReg);
        if( peerSelect.length > 1 ){
            const finds = [];
            peerSelect.forEach(v1 => {
                //注意这里要区分id 和 class
                finds.push( node.parent.obj.class.findIndex(v2=> `.${v2}` == v1) )
            })
            const isParent = finds.every(v=> v!=-1 )
            return isParent ? node.parent.obj : 
                    _findNodeParent(node.parent.obj,select)
        }else{
            //注意这里要区分id 和 class
            const isParent = node.parent.obj.class.findIndex(v2=> `.${v2}` == select)
            return isParent != -1 ? node.parent.obj : 
                    _findNodeParent(node.parent.obj,select)
        }
    }
    
    //寻找元素里面是否含有指定标签
    const _findNodeHasTag = (node,tagname) => {
        for( let i = 0, len = node.childs.length; i < len ; i++ ){
            const key = Object.keys(node.childs[i])
            if( node.childs[i][key].tag == tagname ){
                return true;
            }else{
                if( _findNodeHasTag(node.childs[i][key],tagname) ) return true
            }
        }
        return false;
    }

    //从子节点开始查找
    for( let i = 0 ,len = classSelects.length; i < len; i++ ){
        //存入selectMap
        selectMap[classSelects[i]] = { };
        const that = selectMap[classSelects[i]];
        
        // Page选择器 特殊处理
        if( classSelects[i].match(/page/i) ){
            that.select = true;
            continue;
        }

        //过滤掉伪元素伪类
        const selectQuery = classSelects[i].replace(pseudoClassReg,'')
        //从子节点开始查找 把选择器数组翻转
        const selectNodes = selectQuery.split(' ').filter(v=>v).reverse();

        //选择器只匹配一个元素
        if( selectNodes.length == 1 ){
            that.select = _checkHasSelect(selectNodes[0]) ? true : false
        }
        //多元素选择器
        else{
           // 存放已查找到的元素
           let finds = []; 
           // 对于标签选择器后面再做处理
           let cureetNode = null;
           // 把选择器转化成数组 如 .search-block .search-list .tag 转为 [.tag,.search-list,.search-block]
           for( let i2 = 0,len = selectNodes.length; i2 < len; i2++ ){
                // 为标签选择器
                // 这里可以设置一个到某个元素停止搜索的参数 避免如这种情况 .a view .b view 避免到.a搜到view标签 .b还会继续搜索下去
                if( !/^\.|^\#/.test(selectNodes[i2]) ){
                    // 注意 currentFindNods 是去寻找 用到tag选择器的上一级去寻找它内部是否使用了tag 不过有一种情况就是tag的上级又是tag呢？
                    const currentFindNodes = finds.length ? 
                                             finds :
                                             selectNodeCache[selectNodes[i2+1]]
                    if( currentFindNodes ){    
                        const hasTag =  [];               
                        currentFindNodes.forEach((node,index)=>{
                            hasTag.push( _findNodeHasTag(node,selectNodes[i2]) )
                        })
                        if( hasTag.some(v=>v) ){ 
                            finds = currentFindNodes.concat();
                            that.select = true;
                            continue;
                        }
                        else{
                            that.select = false;
                            break;
                        }
                    }
                    else{
                        that.select = false;
                        break;
                    }
                }
                // 为class id选择器
                else{
                    // 第一个元素选择器走这里 
                    if( i2 == 0 ){
                        let matchNode = null
                        // 判断这个选择器在页面中是否有使用元素
                        if( matchNode = _checkHasSelect(selectNodes[i2]) ){
                            // 注意：  这里似乎没有对同级元素进行处理 
                            // after：发现已经处理  不过可以优化 使用同级元素的class或者id都用上的元素 而不是直接从Cache中找

                            // console.log( selectNodes,'=== 111 ===' )
                            // console.log( selectNodes[i2],'=== 222 ===' )
                            // console.log( selectNode,'=== 333 ===' )
                            // 遍历所有使用到这个选择器的元素
                            matchNode.forEach(v=>{
                                // 搜索是否下个选择器的是否为这个选择器元素的父级
                                finds.push( _findNodeParent( v ,selectNodes[i2+1] ) )
                            })
                            // 如有搜索完毕 确实有元素
                            const hasParent = finds.some(v=>v);
                            // 如果选择器只有两个级别 如 .a .b 则这个选择器搜索完成
                            if( selectNodes.length == 2 ){
                                that.select = hasParent ? true : false
                                break;
                            }
                            else{
                                if( hasParent ){
                                    // 过滤掉null值
                                    finds = finds.filter(v=>v)
                                    // 进行上一级的寻找 因为是 从子级到父级的搜索
                                    continue;
                                }else{
                                    // 没有匹配 结束这个选择器的搜索
                                    that.select = false;
                                    break;
                                }
                            }
                        }
                        // 没有使用到这个选择器的页面元素
                        else{
                            // 没有匹配 结束这个选择器的搜索
                            that.select = false;
                            break;
                        }
                    }
                    else if( i2 == selectNodes.length-1 ){
                        // 每个选择器的最后一步 如果finds还有元素 说明找到了选择器的最顶层 说明页面中正在使用这个选择器
                        that.select = finds.some(v=>v);
                    }
                    else{
                        // 继续搜索上一级 从子级到父级的搜索
                        // 这里逻辑没有问题 不过可以进行优化
                        const _finds = [];
                        finds.map(node=> _findNodeParent( node ,selectNodes[i2+1] ) )
                        finds = finds.filter(v=>v);
                    }
                }
           }
        }
    }

    // console.log( selectNodeCache )
    console.log( selectMap )

    // 检查没有被选中的元素
    // for( let x in selectMap ) {
    //     !selectMap[x].select && console.log(x,selectMap[x])
    // }

})

const debug = (str,plase = true)=>{
    const isDebug = true;
    isDebug && plase && console.log(str)
}

// 取得表情的属性
const getAttr = (tag,attr) => {
    const hasAttr = tag.indexOf(` ${attr}`)
    if( hasAttr ){
        const attrStrStartL = hasAttr + ` ${attr}=`.length;
        // 获取属性在标签的开始位置
        const startMark = tag.substr( attrStrStartL,  1);
        // 获取属性在标签的结束位置
        const endIndex = tag.substring( attrStrStartL + 1 , ).indexOf(startMark);
        //取得整段属性
        const AttrStr = tag.substring( attrStrStartL + 1 , attrStrStartL + endIndex + 1 )
        return AttrStr
    }else{
        return ''
    }
}

// 把Wxml字符串转为树结构
// 在转成树结构的过程中就可以把所有节点存储起来
// 标签不会被覆盖 这个核实过了

// 2019-03-21 
// selectNodeCache不再作为全局变量 而作为getWxmlTree的返回值
const getWxmlTree =  (wxmlStr,isTemplateWxml = false )=>{
        
        // 页面中对应选择器元素
        const pageSelectNodes = {}
        // 组件中对应选择器元素
        const templateSelectNodes = {}
        
        // 模版缓存
        const templateCache = {}
        //存放找到的模版
        const findTemplates = {}
        // 找到的使用模版 反正重名 使用数组
        const findUseTemplates = []

        // 过滤调pageWxml中的注释 
        // 注意 单行注释可以 去除多行注释不成功
        wxmlStr = wxmlStr.replace(/\<!--([\s\S]*?)-->/g,'')

        //Wxml树结构
        const WxmlTree = {
            root:{
                childs:[

                ],
                parent:{
                    key:null,
                    obj:null,
                }
            }
        };
    
        let head = WxmlTree.root;
        let parentkey = 'root';
        
        // 取得标签内的Class
        // 注意还有hover-class 之类的情况
        const _getTagClass = (tag,arr)=>{
    
            let TagClass = arr ? arr : [];
            
            // 判断前面是否有空格 避免匹配到 *-class 
            const hasClass = /\s+class=/;
            // 判断标签是否拥有class
            if( hasClass.test(tag) ){
                // 获取class属性在标签的开始位置
                const startIndex = tag.search(/class\=[\'|\"]/)
                // 判断开始是双引号还是单引号
                const startMark = tag.substr(startIndex+6,1);
                // 获得结束位置
                const endIndex = tag.substring(startIndex + 7 ,tag.length).indexOf(startMark);
                // 取得整段class
                let TagClassStr = tag.substring( startIndex , startIndex + endIndex + 8 );
                
                //获取动态选人的class
                const dynamicClassReg = /\{\{(.*?)\}\}/
                let dynamicClass = '';
                while( dynamicClass = dynamicClassReg.exec(TagClassStr) ){
                    // console.log( dynamicClass,'dynamicClass' )
                    dynamicClass[1].replace(/[\'|\"](.*?)[\'|\"]/g,($1,$2)=>{
                        $2 && TagClass.push($2)
                    })
                    TagClassStr = TagClassStr.replace(dynamicClass[0],'')
                }

                TagClassStr.replace(/class=[\'|\"](.*)[\'|\"]/,function(classStr,classNames){
                    TagClass = TagClass.concat( classNames.split(" ").filter(v=>v) )
                })

                // 一些写法不规范的开发者 会写多个class 这里先不管
                tag = tag.replace(/(class=[\'|\"].*?[\'|\"])/,'');
                if( hasClass.test(tag) ) {
                    return _getTagClass(tag,TagClass)
                }
            }

            return TagClass;
        }
           
        // 取得标签内的id
        const _getId = (tag)=>{
            // 判断前面是否有空格 避免匹配到 *-class 
            const hasId =  /\s+id=/;
            if( hasId.test(tag) ){

                // 获取id属性在标签的开始位置
                const startIndex = tag.search(/id\=[\'|\"]/)
                // 判断开始是双引号还是单引号
                const startMark = tag.substr(startIndex + 3,1);
                // 获得结束位置
                const endIndex = tag.substring(startIndex + 4 ,tag.length).indexOf(startMark);
                // 取得整段id
                const TagIdStr = tag.substring( startIndex , startIndex + endIndex + 5 )
    
                return TagIdStr.replace(/id=[\'|\"](.*)[\'|\"]/,'$1');
            }

            return "";
        }
        
        // 取得标签名称
        const _getTagName = (tag)=>{
            const tagExec = /\<([\w|\-]+)\s?|\/([\w|\-]+)\s?\>/.exec(tag)
            const tagName = tagExec[1] ? tagExec[1] : tagExec[2];
            return tagName
        }

        // 存入节点缓存对象 
        const _setNodeCache = (tag,classes,id,selectNodes)=>{
            //避免用重复class元素
            if( classes.length ){
                classes.forEach(classname=>{
                    if(!selectNodes[`.${classname}`]){
                        selectNodes[`.${classname}`] = [];
                    }
                    selectNodes[`.${classname}`].push(tag);
                })
            }
            //避免有重复id元素
            if( id ){
                if(!selectNodes[`#${id}`]){
                    selectNodes[`#${id}`] = [];
                }
                selectNodes[`#${id}`].push(tag);
            }
        }
        
        // 合并两个selectNode
        // 把nodes2合并入nodes1 最终返回nodes1
        const mergeSelectNode = (nodes1,nodes2)=>{

            const node2Keys = Object.keys(nodes2)
            node2Keys.forEach(key=>{
                if(nodes1[key]){
                    nodes1[key] = nodes1[key].concat(nodes2[key])
                }else{
                    nodes1[key] = nodes2[key]
                }
            })
            return nodes1
        }
                        
        const isSingeTagReg = /\<(.*)\/\>/;
        const isCloseTagReg = /\<\/(.*)\>/;
        const isCompleteTagReg = /\<.*\>.*\<.*\>/

        // 是否import标签
        const isImportReg = /import/i; 
        // 是否template标签
        const isTemplateReg = /template/i;
        
        return new Promise( async (resolve,reject)=>{
            // 从上到下获取全部标签    
            // 注意标签连写情况 如：<view>A</view><view>B</view><view>C</view>
            let match = null

            while( match = /\<[\s\S]*?\>/.exec(wxmlStr) ){

                let $1 = match[0]
                debug($1,'$1')
                wxmlStr = wxmlStr.replace($1,'');

                const tagClass = _getTagClass($1);
                const tagId = _getId($1);
                const tagName = _getTagName($1);

                if( isImportReg.test(tagName) ){
                    const importSrc =  getAttr($1,'src');
                    findTemplates[importSrc] =  () => new Promise( async (_resolve,_reject)=>{
                        let templatePath = '';
                        
                        // 查找模版规则 首先查找相对路径 如果相对路径没有 则尝试绝对路径 如果都没有则弹出错误 当时不印象继续往下执行
                        templatePath = path.join( path.join( PAGES_PATH,PAGE_DIR_PATH ), importSrc );
                        fsp.readFile(templatePath,'utf-8')
                        .catch(err=>{
                            templatePath = path.join( WX_DIR_PATH,importSrc )
                            return fsp.readFile(templatePath,'utf-8')
                        })
                        .catch(err=>{
                            console.log('没有找到模版文件 模版地址:',importSrc);
                            reject( )
                        })
                        .then(tmp =>{
                            return getTemplateWxmlTree(importSrc,tmp)
                        })
                        .then(res =>{
                            debug( 'resolve ===========' )
                            _resolve(res)
                        })
                        .catch(err=>{
                            console.log('getTemplateWxmlTree执行时遇到错误')
                            console.log(err)
                            reject()
                        })

                    })
                }

                //是否单标签
                if( isSingeTagReg.test($1) ){
                    debug('是单标签')

                    const self = {
                        [$1]:{
                            childs:[],
                            class:tagClass,
                            id:tagId,
                            tag:tagName,
                            statrTag:true,
                            endTag:true,
                            parent:{
                                key:parentkey,
                                obj:head    
                            }
                        }
                    }

                    //收集使用的模版
                    if( isTemplateReg.test(tagName) && !isTemplateWxml ){
                        findUseTemplates.push( { [getAttr($1,'is')] : self } )
                    }

                    _setNodeCache(self[$1],tagClass,tagId,isTemplateWxml ? templateSelectNodes : pageSelectNodes)

                    head.childs.push(self)

                    continue;
                }
        
                //是否闭合标签
                if( isCloseTagReg.test($1) ){
                    debug('是闭合标签')

                    const isCompleteTag = isCompleteTagReg.test($1);

                    //需找到闭合标签 把指针指向上一层
                    if( !isCompleteTag ){
                        try{
                            debug(head,false)
                            parentkey = head.parent.key
                            head = head.parent.obj
                        }catch(e){
                            console.log('完毕标签 head 报错')
                            debug(e)
                            return;
                        }   
                    }

                    const self = {
                        [$1]:{
                            childs:[],
                            class:tagClass,
                            id:tagId,
                            tag:tagName,
                            statrTag:isCompleteTag ? true : false,
                            endTag:true,
                            parent:{
                                key:parentkey,
                                obj:head    
                            }
                        }
                    }

                    if( isTemplateReg.test(tagName) && !isTemplateWxml ){
                        findUseTemplates.push( { [getAttr($1,'is')] : self } )
                    }

                    if( isCompleteTag ){
                        _setNodeCache(self[$1],tagClass,tagId,isTemplateWxml ? templateSelectNodes : pageSelectNodes)
                    }

                    try{
                        debug(head,false)
                        head.childs.push(self)
                    }catch(e){
                        console.log('闭合标签 head 报错')
                        debug(e)
                        return;
                    }

                    continue;
                }

                debug('是起始标签')
                
                //不是闭合标签 也不是 单标签 就是启始标签
                const self = {
                    [$1]:{
                        childs:[],
                        class:tagClass,
                        id:tagId,
                        tag:tagName,
                        statrTag:true,
                        endTag:false,
                        parent:{
                            key:parentkey,
                            obj:head
                        }
                    }
                }

                if( isTemplateReg.test(tagName) && !isTemplateWxml ){
                    findUseTemplates.push( { [getAttr($1,'is')] : self } )
                }

                _setNodeCache(self[$1],tagClass,tagId,isTemplateWxml ? templateSelectNodes : pageSelectNodes)
                
                try{
                    debug(head,false)
                    head.childs.push(self)
                }catch(e){
                    console.log('启始标签 head 报错')
                    debug(e)
                    return;
                }

                //把指针指向这个标签
                head = self[$1];
                parentkey = $1;
        
            }
            
            if( !isTemplateWxml ){
                for( const name in findTemplates ){
                    templateCache[name] = await findTemplates[name]()
                }
            }

            findUseTemplates.forEach(usetml=>{
                // 准备被替换的模版
                let replaceTml = null;
                const useTemplateName = Object.keys(usetml)[0];

                for( let importTmlPath in templateCache ){
                    if( templateCache[importTmlPath][useTemplateName] ){
                        replaceTml = templateCache[importTmlPath][useTemplateName]
                        break;
                    }
                }

                if( replaceTml ){
                    const { templateWxmlTree, selectNodeCache } = replaceTml
                    // 找到要被替换模版在父组件的位置
                    const useTemplateStr = Object.keys(usetml[useTemplateName])[0]
                    let templateParentTheChilren = usetml[useTemplateName][useTemplateStr].parent.obj.childs;
                    let templatehaschildrenNodeIndex = templateParentTheChilren.indexOf(usetml[useTemplateName])    
                    // 进行替换 
                    Array.prototype.splice.apply( templateParentTheChilren,[templatehaschildrenNodeIndex,1,...templateWxmlTree] )
                    // 合并 页面的selectNode 和 组件的selectNode
                    mergeSelectNode( pageSelectNodes,selectNodeCache )
                }
            })

            resolve({ WxmlTree,selectNodeCache: isTemplateWxml ? templateSelectNodes : pageSelectNodes });
        })
}

// 把Wxml字符串转为树结构
const getTemplateWxmlTree = async (temkey,wxmlStr) => {
    const templates = {};
    const templateStartRegExp = /\<template.*\>/
    const templateEndRegExp = /\<\/template.*\>/
    
    const wxmlStrFindTemplate = (str,finds) => {
        finds = finds || [];
        let templateName = ''
        const templateStartIndex = str.search(templateStartRegExp)
        const templateEndIndex = str.search(templateEndRegExp) 

        if( templateStartIndex!= -1 && templateEndIndex != -1 ){
          let tpl = str.substr(templateStartIndex,templateEndIndex + 11)
          str = str.replace(tpl,'')
          finds.push({ name:'',tpl:tpl.replace(templateStartRegExp,($1,$2)=>{
                templateName = getAttr($1,'name')
                return ''
          })
          .replace(templateEndRegExp,'') })
          finds[finds.length-1].name = templateName;
          return wxmlStrFindTemplate(str,finds)
        }
        return finds;
    }

    const templateStrArr = wxmlStrFindTemplate(wxmlStr)
    for( let index = 0,len = templateStrArr.length; index < len ; index++ ){
        const templateName = templateStrArr[index].name
        debug( templateStrArr[index].name,'<<<<<<<<<<<<<<<<<<<<< templateName >>>>>>>>>>>>>>>>>>>>>' )
        const { WxmlTree:templateWxmlTree,selectNodeCache } = await getWxmlTree(templateStrArr[index].tpl,true)
        templates[templateName] = {
            templateWxmlTree:templateWxmlTree.root.childs,
            selectNodeCache
        }
    }

    return templates
    
}