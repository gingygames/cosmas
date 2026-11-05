-- multitrack-mix.lua
-- Přehrává víc zvukových stop jednoho videa najednou (mpv / mpv.net).
--
-- Klávesy:
--   Ctrl+1 .. Ctrl+9   zapne/vypne zvukovou stopu 1..9 v mixu
--   Ctrl+0             zapne všechny stopy kromě 1. (u Medalu je 1. stopa celý mix)
--   Ctrl+-             zpět na normální přehrávání (jen jedna stopa)
--   Ctrl+=             ukáže, které stopy hrají
--
-- Volitelně v script-opts/multitrack-mix.conf:
--   default_mix=2,3      # tyto stopy se zapnou automaticky po otevření souboru
--   default_mix=stems    # všechny stopy kromě 1.

local mp = require 'mp'
local options = require 'mp.options'

local opts = { default_mix = "" }
options.read_options(opts, "multitrack-mix")

local mix = {}      -- id stopy -> true
local active = false

local function audio_tracks()
    local list = {}
    for _, t in ipairs(mp.get_property_native("track-list") or {}) do
        if t.type == "audio" then list[#list + 1] = t end
    end
    return list
end

local function sorted_ids()
    local ids = {}
    for id in pairs(mix) do ids[#ids + 1] = id end
    table.sort(ids)
    return ids
end

local function show()
    local lines = {}
    for _, t in ipairs(audio_tracks()) do
        local on
        if active then on = mix[t.id] else on = t.selected end
        local name = t.title or t.lang or ""
        lines[#lines + 1] = string.format("%s %d  %s", on and "[x]" or "[ ]", t.id, name)
    end
    local mode = active and "Mix stop" or "Normální přehrávání"
    mp.osd_message(mode .. "\n" .. table.concat(lines, "\n"), 3)
end

local function apply()
    local ids = sorted_ids()
    if #ids <= 1 then
        -- 0 nebo 1 stopa: bez filtru, běžné přehrávání
        active = false
        mp.set_property("lavfi-complex", "")
        mp.set_property("aid", ids[1] and tostring(ids[1]) or "no")
    else
        active = true
        local inputs = ""
        for _, id in ipairs(ids) do inputs = inputs .. "[aid" .. id .. "]" end
        local graph = inputs .. "amix=inputs=" .. #ids .. ":normalize=0[ao]"
        mp.set_property("lavfi-complex", graph)
    end
    show()
end

local function seed_from_current()
    if next(mix) == nil then
        local cur = mp.get_property_number("aid")
        if cur then mix[cur] = true end
    end
end

local function toggle(n)
    local tracks = audio_tracks()
    local exists = false
    for _, t in ipairs(tracks) do if t.id == n then exists = true end end
    if not exists then
        mp.osd_message("Stopa " .. n .. " neexistuje (soubor má " .. #tracks .. " zvukových stop)", 2)
        return
    end
    if not active then seed_from_current() end
    if mix[n] then mix[n] = nil else mix[n] = true end
    apply()
end

local function stems()
    mix = {}
    for _, t in ipairs(audio_tracks()) do
        if t.id ~= 1 then mix[t.id] = true end
    end
    apply()
end

local function reset()
    local ids = sorted_ids()
    mix = {}
    active = false
    mp.set_property("lavfi-complex", "")
    mp.set_property("aid", ids[1] and tostring(ids[1]) or "auto")
    show()
end

for i = 1, 9 do
    mp.add_key_binding("Ctrl+" .. i, "toggle-" .. i, function() toggle(i) end)
end
mp.add_key_binding("Ctrl+0", "stems", stems)
mp.add_key_binding("Ctrl+-", "reset", reset)
mp.add_key_binding("Ctrl+=", "show", show)

-- Nový soubor = začít načisto
mp.register_event("start-file", function()
    mix = {}
    active = false
    mp.set_property("lavfi-complex", "")
end)

mp.register_event("file-loaded", function()
    local d = opts.default_mix
    if d == "" then return end
    if d == "stems" then stems() return end
    mix = {}
    local n = #audio_tracks()
    for num in d:gmatch("%d+") do
        local id = tonumber(num)
        if id <= n then mix[id] = true end
    end
    if next(mix) then apply() end
end)
