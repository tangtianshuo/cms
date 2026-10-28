/** Translate API failures at the UI boundary; keep SDK errors intact for callers. */
const messages: Record<string, string> = {
    'Draft content changed after validation; check again before publishing': '检查后草稿已有变化，请重新检查后发布。',
    'Gateway active deployment has not confirmed this publication': 'Gateway 尚未确认本次切流，请稍后刷新部署状态。',
    'A newer Gateway deployment was already recorded; refresh': '已有更新的线上版本，请刷新后操作。',
    'Wrong email and/or password':
        '邮箱或密码不正确，请检查邮箱拼写及密码后重新登录。',
    'Invalid server token':
        '服务器令牌不正确，请向管理员确认安装时配置的令牌后重新输入。',
    'Not logged in.': '您尚未登录或登录已过期，请重新登录后继续操作。',
    'Invalid refresh token format': '登录凭证已失效，请重新登录后继续操作。',
    'Failed to create access token.':
        '服务器未能生成登录凭证，请稍后重试；如仍无法登录，请联系管理员检查登录服务。',
    'Workspace is read only':
        '您在当前工作区只有只读权限，无法保存修改。请联系工作区管理员开通编辑权限。',
    'Workspace access denied':
        '您没有当前工作区的访问权限，请切换到有权访问的工作区，或联系管理员添加成员权限。',
    'Site access denied':
        '您没有当前站点的访问权限，请重新选择有权访问的站点，或联系管理员。',
    'Template access denied':
        '您没有此模板的操作权限，请联系管理员调整内容权限。',
    'API key workspace access denied':
        '当前 API 密钥没有此工作区的访问权限，请联系管理员检查密钥授权范围。',
    'API key access revoked':
        '当前 API 密钥的访问权限已被撤销，请联系管理员重新授权。',
    'User access revoked':
        '您的访问权限已被撤销，请联系管理员确认账号及工作区成员权限。',
    'Resource creation denied':
        '您没有创建此类资源的权限，请联系管理员开通相应的内容权限。',
    'Invalid workspace name':
        '工作区名称不能为空，且不能超过 80 个字符，请修改名称后重试。',
    'Invalid site name':
        '站点名称不能为空，且不能超过 80 个字符，请修改名称后重试。',
    'Site name must be 1-80 characters':
        '站点名称不能为空，且不能超过 80 个字符，请修改名称后重试。',
    'Default workspace cannot be deleted':
        '默认工作区用于系统运行，无法删除。您可以创建和管理其他工作区。',
    'Workspace contains sites':
        '此工作区仍包含站点，请先处理其中的站点，再删除工作区。',
    'Workspace contains resources':
        '此工作区仍包含内容资源，请先处理其中的内容，再删除工作区。',
    'Workspace has pending creation operations':
        '此工作区正在创建资源，请等待创建完成后再删除。',
    'Invalid member':
        '成员信息不符合要求，请检查用户 ID 是否正确，并选择有效的工作区角色。',
    'Cannot change your own administrator role':
        '您无法修改自己的工作区管理员角色，请让另一位管理员协助调整。',
    'Cannot remove your own administrator membership':
        '您无法移除自己的管理员身份，请让另一位工作区管理员协助操作。',
    'You are not allowed to delete yourself':
        '您无法删除当前登录的账号，请让其他管理员协助处理。',
    'You cannot change your role. Ask other admin to do that for you':
        '您无法修改自己的角色，请让其他管理员协助调整权限。',
    'Could not save workspace selection':
        '浏览器未能保存工作区选择，请检查是否禁用了网站存储，再重新选择工作区。',
    'Workspace selection is changing':
        '正在切换工作区，请等待切换完成后再操作。',
    'Workspace selection changed':
        '工作区已切换，本次操作对应原来的工作区，请在当前工作区重新操作。',
    'Invalid workspace selector':
        '保存的工作区选择无效，请在“工作区与站点”中重新选择。',
    'Site not found in workspace':
        '当前工作区中找不到所选站点，站点可能已被删除或移动，请重新选择站点。',
    'Create and select a site before installation':
        '尚未选择站点，请先在“工作区与站点”中创建或选择站点，再导入模板。',
    'Another preset is already installed':
        '当前站点已安装另一套模板，请新建站点后再导入这套模板。',
    'Template conflict prevents import':
        '现有内容模型与模板要求冲突，请查看模型冲突列表，调整后再导入，或使用新站点安装。',
    'Template name belongs to another owner':
        '此模型名称已被其他内容模型使用，请调整冲突模型的名称，或在新站点安装模板。',
    'Single-entry setting differs':
        '现有模型的“单条目”设置与模板要求不一致，请调整对应设置，或在新站点安装模板。',
    'Public template version changed; refresh the catalog':
        '公开模板版本已更新，请刷新模板目录后重新选择版本。',
    'Public template schema changes require a new installation':
        '这版模板的内容结构发生了变化，无法直接升级，请在新站点中安装。',
    'Only a compatible version of the installed template can be adopted':
        '所选版本与当前已安装模板不兼容，请选择同一模板的兼容版本。',
    'Site has no verified public template':
        '当前站点尚未安装经过验证的公开模板，请先导入公开模板再发布。',
    'Storefront is disabled':
        '独立站服务尚未启用，请联系管理员启用服务后再预览或发布。',
    'Invalid publication request or storefront disabled':
        '发布参数不符合要求或独立站服务未启用，请刷新页面重试；如仍失败，请联系管理员检查独立站配置。',
    'Site is not installed': '当前站点尚未安装模板，请先导入模板。',
    'Site not installed': '当前站点尚未安装模板，请先导入模板，再配置域名。',
    'Site is not ready': '站点尚未准备完成，请等待模板导入完成后再操作。',
    'Site import is not ready':
        '站点模板尚未导入完成，请等待导入完成后再操作。',
    'Site not found': '找不到当前站点，站点可能已被删除，请重新选择站点。',
    'Page not found':
        '找不到此页面，页面可能已被删除，请刷新页面列表后重新选择。',
    'Page draft not found': '找不到此页面草稿，请刷新页面列表后重新选择页面。',
    'Invalid title or SEO text':
        '页面标题不能为空；页面标题和 SEO 标题最多 120 个字符，SEO 描述最多 320 个字符，请检查后保存。',
    'Invalid page path':
        '页面路径格式不正确：请以 / 开头，仅使用小写英文字母、数字和连字符，例如 /about-us；多级路径可写为 /help/contact。',
    'This page path is fixed':
        '首页和动态详情页的路径由模板固定，无法修改，请保留原来的路径。',
    'Page path is reserved':
        '此路径已被系统保留，请使用其他页面路径，例如 /about-us。',
    'Page path conflicts with another blueprint':
        '此路径与已有页面或动态详情页的路径重复，请修改路径后再保存。',
    'Invalid or duplicate page key':
        '页面标识格式不正确或已被使用，请刷新页面列表后重新创建页面。',
    'Invalid page sections':
        '页面区块配置不符合模板要求，请保留必需区块、移除重复或不支持的区块后再保存。',
    'Invalid page Entry binding':
        '所选内容条目与此页面的内容模型不匹配，请重新选择对应模型下的条目。',
    'A new page requires an Entry binding':
        '新页面尚未绑定内容，请在“内容条目”中选择对应内容后再保存。',
    'Home page is required':
        '站点发布时必须保留首页，请勾选首页的“加入下次发布”。',
    'Unsupported page blueprint':
        '所选页面蓝图不支持创建新页面，请刷新后选择其他页面蓝图。',
    'Invalid page draft':
        '页面草稿的数据格式不符合要求，请检查标题、路径和区块配置后重新保存。',
    'Invalid new page':
        '新页面信息不完整或格式不正确，请检查标题、路径、页面蓝图和绑定内容后再保存。',
    'Entry does not belong to the product template':
        '当前内容条目不属于商品模型，请选择商品模型中的条目后再预览。',
    'Product requires a slug, name, and non-negative price':
        '商品尚不能预览：请填写路径标识和商品名称，并将价格设置为大于或等于 0 的数字。',
    'Invalid import request':
        '模板导入信息不符合要求，请检查站点名称并重新选择模板后再导入。',
    'Invalid theme color':
        '主题颜色格式不正确，请输入十六进制颜色值，例如 #336699。',
    'Unsupported theme font':
        '所选字体不在模板支持范围内，请从模板提供的字体中选择。',
    'Invalid hostname':
        '域名格式不正确，请只填写域名，例如 shop.example.com，不要包含 https://、端口或页面路径。',
    'Domain already bound':
        '此域名已被绑定，请检查现有域名绑定；如属于其他站点，请先在原站点解绑。',
    'Choose a replacement primary domain first':
        '此域名是当前主域名，请先将另一个已就绪的域名设为主域名，再停用或解绑。',
    'Domain must be enabled, verified and ready':
        '此域名尚未满足主域名条件，请先启用域名、完成 TXT 归属验证，并通过接入检查。',
    'Verification expired; remove and add the domain again':
        '域名 TXT 验证已过期，请移除此绑定后重新添加域名，并使用新的验证值。',
    'Check rate limited; retry in 10 seconds':
        '域名检查过于频繁，请等待 10 秒后再检查。',
    'DNS or HTTPS check timed out':
        '域名的 DNS 或 HTTPS 检查超时，请确认 DNS 已生效、HTTPS 可以访问后再检查。',
    'DNS must resolve exclusively to public addresses':
        '域名解析包含内网或保留 IP，请将所有解析记录改为独立站接入服务的公网地址后再检查。',
    'Invalid challenge response':
        '域名的 HTTPS 验证响应不符合要求，请联系管理员检查验证路径是否正确转发到独立站网关。',
    'TXT ownership record missing or incorrect':
        '域名 TXT 归属记录缺失或不正确，请在 DNS 服务商处核对记录名称和验证值，等待解析生效后重新检查。',
    'TXT record lookup failed':
        '未能查询到域名 TXT 记录，请确认 DNS 中已添加归属验证记录，等待解析生效后重新检查。',
    'HTTPS challenge signature did not match the configured storefront':
        '域名 HTTPS 验证结果与当前独立站不一致，请联系管理员检查域名是否指向正确网关，以及验证密钥是否一致。',
    'HTTPS challenge failed':
        '域名 HTTPS 验证未通过，请联系管理员检查证书及网关验证路径配置后再检查。',
    'Domain not found': '找不到此域名绑定，绑定可能已被移除，请刷新域名列表。',
    'Configure storefront gateway and domain secrets first':
        '独立站网关地址或域名验证密钥尚未配置，请联系管理员完成配置后再添加域名。',
    'Domain challenge secret is not configured':
        '域名验证密钥尚未配置，请联系管理员完成配置后再检查域名。',
    'Gateway CMS binding and service secret are required':
        '发布服务缺少 CMS 绑定信息或服务密钥，请联系管理员完成发布网关配置。',
    'This CMS site is not bound to the configured Gateway target':
        '当前站点与发布网关中配置的站点不一致，请联系管理员检查站点绑定。',
    'A Gateway publication is still pending':
        '上一次发布仍在部署中，请等待部署完成后再发布。',
    'A Gateway publication is still pending; wait before adopting another version':
        '当前版本仍在发布中，请等待发布完成后再采用其他模板版本。',
    CANDIDATE_CREATE_FAILED:
        '未能准备本次部署所需的资源，请联系管理员检查模板镜像是否可用及服务器剩余资源，处理后重新检查并发布。',
    CANDIDATE_START_FAILED:
        '新版网站未能启动，请联系管理员检查网站运行配置与启动日志，处理后重新检查并发布。',
    CANDIDATE_UNHEALTHY:
        '新版网站未通过健康检查或首页访问检查，尚未切换上线。请联系管理员检查模板与发布内容，处理后重新检查并发布。',
    ROUTE_SWITCH_FAILED:
        '新版网站的访问切换未能完成，请先刷新发布状态并确认线上网站；如仍失败，请联系管理员检查网关路由后再发布。',
    WORKER_INTERNAL_ERROR:
        '发布服务处理本次部署时发生异常，请先刷新发布状态确认结果；如仍失败，请联系管理员检查发布服务日志后再发布。',
    revision_conflict:
        '发布版本已被其他操作更新，请刷新页面查看最新站点状态，重新校验后再发布。',
    'Gateway revision conflict; start a new publication after reviewing the current site state':
        '发布版本已被其他操作更新，请刷新页面查看最新站点状态，重新校验后再发布。',
};

const modelNames: Record<string, string> = {
    product: '商品',
    collection: '商品集合',
    home: '首页',
    'content-page': '内容页',
    'site-settings': '站点设置',
};
const inputNames: Record<string, string> = {
    email: '邮箱',
    password: '密码',
    firstName: '名',
    lastName: '姓',
    serverToken: '服务器令牌',
    title: '标题',
    slug: '路径标识',
    label: '名称',
    name: '名称',
    siteName: '站点名称',
    hostname: '域名',
};
const valueTypes: Record<string, string> = {
    string: '文本',
    number: '数字',
    boolean: '是或否',
    object: '对象',
    'object.array': '列表',
    array: '列表',
};

function fieldName(value: string): string {
    const [model, ...fields] = value.split('.');
    return [modelNames[model] || model, ...fields].join(' / ');
}

type ErrorDetails = {
    message?: unknown;
    status?: number;
    statusCode?: number;
    code?: unknown;
    response?: { status?: number; data?: { message?: unknown } };
};

/** A reason and next step in Chinese. Unknown failures must not invent a cause. */
export function userErrorMessage(cause: unknown): string {
    const details: ErrorDetails =
        cause && typeof cause === 'object' ? cause : {};
    const raw = details.response?.data?.message ?? details.message ?? cause;
    const message = typeof raw === 'string' ? raw.trim() : '';
    const status =
        details.response?.status ?? details.status ?? details.statusCode;
    const known = messages[message];
    if (typeof known === 'string') return known;

    // Domain verification can return several independent checks together.
    if (message.startsWith('TXT ') && message.includes('; ')) {
        return [
            ...new Set(
                message.split('; ').map((part) => userErrorMessage(part)),
            ),
        ].join('\n');
    }

    if (
        /normalized title|workspace_group_language_title_unique/i.test(message)
    ) {
        return '当前工作区、分组和语言中已存在相同标题的内容，请修改标题或更换分组后再保存。';
    }
    let match: RegExpMatchArray | null;
    if ((match = message.match(/^\[([^\]]+)\] -> (.+)$/))) {
        const path = match[1]
            .replace(/^body\.(?:meta\.)?/, '')
            .replace(/\.props\./g, ' / ')
            .replace(/\.data(?:\.(\d+))?$/, (_, index) =>
                index === undefined ? '' : ` 第 ${Number(index) + 1} 项`,
            );
        if (/Property is required|No value found/i.test(match[2])) {
            return `“${path}”为必填字段，当前尚未填写，请补全后再保存。`;
        }
        return `“${path}”的内容格式与字段设置不一致，请检查字段类型、列表及关联内容后再保存。`;
    }
    if (
        (match = message.match(
            /Type mismatch.*?property '([^']+)'.*?Expected '([^']+)'/,
        ))
    ) {
        return `“${inputNames[match[1]] || match[1]}”的格式不正确，请填写${
            valueTypes[match[2]] || '符合字段设置的内容'
        }后重试。`;
    }
    if ((match = message.match(/Object is missing property '([^']+)'/))) {
        return `尚未填写“${
            inputNames[match[1]] || match[1]
        }”，请补全此项后重试。`;
    }
    if ((match = message.match(/^Field (\S+) is incompatible$/))) {
        return `字段“${match[1]}”的类型、是否为列表或必填设置与模板要求不一致，请调整对应字段，或在新站点安装模板。`;
    }
    if ((match = message.match(/^Invalid required field (\S+) \(([^)]+)\)$/))) {
        return `“${fieldName(
            match[1],
        )}”为必填字段，当前值为空或不符合要求（条目 ${
            match[2]
        }），请打开对应条目修正后重新校验发布。`;
    }
    if (
        (match = message.match(
            /^(?:Invalid value|Invalid field binding:|Invalid related Entry:|Missing image media:) (\S+)$/,
        ))
    ) {
        return `“${fieldName(
            match[1],
        )}”的值、关联内容或图片不符合要求，请打开对应条目检查并修正后重新校验。`;
    }
    if (
        (match = message.match(/^Missing content for (.+) in language (\S+)$/))
    ) {
        return `页面“${match[1]}”缺少 ${match[2]} 语言的内容，请补全该语言的内容后重新校验发布。`;
    }
    if (
        (match = message.match(
            /^Exactly one (\S+) Entry is required for language (\S+)$/,
        ))
    ) {
        return `“${fieldName(match[1])}”在 ${
            match[2]
        } 语言下需要且只能有一条内容，请检查是否缺少内容或存在重复条目。`;
    }
    if ((match = message.match(/^Duplicate page path: (.+)$/))) {
        return `页面路径“${match[1]}”重复，请为对应页面设置不同路径后重新校验发布。`;
    }
    if ((match = message.match(/^SEO title is required: (.+)$/))) {
        return `页面“${match[1]}”尚未填写 SEO 标题，请补全后重新校验发布。`;
    }
    if ((match = message.match(/^Broken internal link: (.+)$/))) {
        return `站内链接“${match[1]}”没有对应的发布页面，请修改链接或将目标页面加入发布。`;
    }
    if (
        (match = message.match(
            /^(?:Related|Navigation) Entry has no published page: (.+)$/,
        ))
    ) {
        return `关联条目“${match[1]}”没有可发布的页面，请检查内容绑定，并将目标页面加入发布。`;
    }
    if (
        (match = message.match(
            /^Existing (?:field|model) (\S+) is incompatible$/,
        ))
    ) {
        return `已有模型或字段“${fieldName(
            match[1],
        )}”与模板要求不兼容，请调整对应模型，或在新站点安装模板。`;
    }
    if (
        (match = message.match(
            /^(?:Entry|Template|Group|Widget|Media|User|Status) with (?:ID|email) ["']?(.+?)["']? (?:does not exist|not found)\.?$/i,
        ))
    ) {
        return `找不到所选资源“${match[1]}”，资源可能已被删除，请刷新列表后重新选择。`;
    }
    if (/^User with email .+ already exists\.?$/i.test(message)) {
        return '此邮箱已被其他用户使用，请使用其他邮箱，或在用户列表中编辑已有账号。';
    }
    if (
        /^(?:Site|CMS site|Published site|Workspace|Domain) changed|^Workspace no longer exists/i.test(
            message,
        )
    ) {
        return '当前站点、工作区或域名状态已发生变化，本次操作未能完成。请刷新页面、确认最新状态后重新操作。';
    }
    if (
        /Network Error|Failed to fetch|fetch failed|ERR_NETWORK|ENOTFOUND|ECONNREFUSED/i.test(
            message,
        ) ||
        details.code === 'ERR_NETWORK'
    ) {
        return '网络连接未成功，暂时无法连接服务器。请检查网络连接后重试；如仍无法连接，请联系管理员检查服务是否可用。';
    }
    if (
        /timeout|timed out/i.test(message) ||
        ['ECONNABORTED', 'ETIMEDOUT'].includes(String(details.code))
    ) {
        return '请求超时，未能及时收到服务器响应。请稍后刷新页面确认操作结果，再决定是否重试。';
    }
    if (/^Gateway request failed \(\d+\)$/.test(message)) {
        return '发布网关未能完成请求，请稍后查看发布状态；如持续失败，请联系管理员检查网关服务。';
    }
    if (
        (match = message.match(
            /^HTTPS challenge returned (\d+); redirects are not accepted$/,
        ))
    ) {
        return `域名 HTTPS 验证路径返回了 ${match[1]} 状态，请联系管理员将验证路径直接转发到独立站网关，避免重定向。`;
    }
    if (/^Public template registry/.test(message)) {
        return '公开模板目录服务暂时不可用或返回的数据不符合要求，请稍后刷新目录；已安装站点仍可继续编辑。';
    }
    if (
        /^(?:Installed (?:public )?template|Public template manifest checksum)/.test(
            message,
        )
    ) {
        return '已安装模板的数据不完整或校验不一致，请联系管理员检查模板版本及安装记录后再操作。';
    }
    // Existing Chinese validation messages already identify the user's problem.
    if (/[\u3400-\u9fff]/.test(message)) return message;

    switch (status) {
        case 400:
        case 422:
            return '提交的信息未通过校验，服务器未提供具体字段原因。请检查表单中的必填项和格式后重试；如仍失败，请联系管理员。';
        case 401:
            return '您尚未登录或登录已过期，请重新登录后继续操作。';
        case 403:
            return '您没有执行此操作的权限，请联系管理员检查账号及当前工作区的权限。';
        case 404:
            return '找不到请求的页面或资源，资源可能已被删除，请刷新列表后重新选择。';
        case 409:
            return '提交的内容与现有数据或最新状态冲突，请刷新页面检查重复内容及最新状态后再操作。';
        case 413:
            return '上传文件或提交内容的大小超过服务器限制，请缩小文件或分批上传后重试。';
        case 429:
            return '操作过于频繁，服务器暂时限制了请求，请稍等片刻后再试。';
        case 502:
        case 503:
        case 504:
            return '服务暂时不可用，服务器未能正常响应。请稍后重试；如持续出现，请联系管理员检查服务状态。';
    }
    if (status && status >= 500)
        return '服务器处理请求时发生异常，暂时无法完成操作。请稍后重试；如仍出现，请联系管理员查看服务日志。';
    return '暂时无法完成操作，未能获取具体的问题原因。请稍后重试；如仍出现，请联系管理员协助排查。';
}
