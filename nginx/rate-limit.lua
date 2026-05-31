local limit = require "resty.limit.req"
local lim, err = limit.new("steelcore_limit", 10, 20)
if not lim then
    ngx.log(ngx.ERR, "failed to instantiate rate limiter: ", err)
    return
end

local key = ngx.var.binary_remote_addr
local delay, err = lim:incoming(key, true)
if not delay then
    if err == "rejected" then
        return ngx.exit(429)
    end
    ngx.log(ngx.ERR, "failed to limit request: ", err)
    return
end
